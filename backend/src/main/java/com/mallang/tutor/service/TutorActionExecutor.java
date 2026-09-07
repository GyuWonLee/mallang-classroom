package com.mallang.tutor.service;

import com.mallang.chat.dto.ChatDtos.DirectMessageRequest;
import com.mallang.chat.service.ChatRouterService;
import com.mallang.chat.service.DirectChatService;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.material.entity.Material;
import com.mallang.material.entity.MaterialStatus;
import com.mallang.material.repository.MaterialRepository;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.tutor.entity.AiTutorMessage;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * 말랑이가 제안한 액션의 <b>검증과 실행</b>.
 *
 * <p>LLM 이 고른 값은 여기 오기 전까지 믿지 않는다. 특히 materialId 는 모델이 지어낼 수 있어
 * "지금도 이 학급의, 선생님이 확인을 마친(READY) 자료인가" 를 제안 시점과 실행 시점에 각각 확인한다.
 * 사이에 자료가 지워지거나 확인이 취소될 수 있기 때문이다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TutorActionExecutor {

    /** 선생님에게 어떤 경로로 갔는지 — 아이 화면 문구가 달라진다. */
    public enum Delivery { SESSION_ROUTED, DIRECT_MESSAGE }

    public record Result(Delivery delivery, Long materialId, String materialTitle) {
        static Result delivered(Delivery delivery) {
            return new Result(delivery, null, null);
        }

        static Result material(Material material) {
            return new Result(null, material.getId(), material.getTitle());
        }
    }

    private final LiveSessionRepository liveSessionRepository;
    private final ChatRouterService chatRouterService;
    private final DirectChatService directChatService;
    private final MaterialRepository materialRepository;
    private final ClassroomMemberRepository memberRepository;
    /** 아이의 학년을 본다 — 학년별 수업 중 어디로 보낼지 고르는 데 쓴다 */
    private final UserRepository userRepository;

    /**
     * 이미 저장된 SHOW_MATERIAL 제안이 지금도 열어 줄 수 있는 자료인지. 아니면 비어 있다.
     *
     * <p>새 제안은 더 이상 만들지 않지만(AiTutorClient.parseAction 주석), 배포 시점에 아직
     * PENDING 인 행이 최대 24시간 남아 있어 실행 경로는 살아 있어야 한다.</p>
     */
    public Optional<Material> findOfferable(Long classroomId, Long materialId) {
        if (materialId == null) {
            return Optional.empty();
        }
        return materialRepository.findById(materialId)
                .filter(m -> m.getClassroom().getId().equals(classroomId))
                .filter(m -> m.getStatus() == MaterialStatus.READY);
    }

    /** 학생이 확인(CONFIRM)한 액션을 실제로 실행한다. */
    public Result execute(AuthUser student, AiTutorMessage message) {
        Long classroomId = message.getClassroom().getId();
        return switch (message.getActionType()) {
            case ASK_TEACHER -> askTeacher(student, classroomId, message.getActionContent());
            case SHOW_MATERIAL -> showMaterial(classroomId, message.getActionMaterialId());
        };
    }

    /**
     * 선생님에게 붙이는 출처 표시.
     *
     * <p>이 글은 아이가 직접 친 문장이 아니라 <b>말랑이가 아이 질문을 정리한 것</b>이다. 표시가
     * 없으면 선생님은 아이가 쓴 말로 읽는다 — 말투가 어른스러워 위화감이 생기고, 무엇보다
     * "이 아이가 이렇게 말했다"는 잘못된 사실이 선생님 기억에 남는다.</p>
     */
    private static final String RELAY_PREFIX = "[말랑이가 대신 전함] ";

    /**
     * 착지점이 둘이다. 수업 중이면 수업 채팅으로 보내 선생님 화면에 바로 뜨게 하고,
     * 아니면 학급 선생님에게 쪽지로 남긴다. 아이에게 어느 쪽으로 보낼지 묻지 않는다.
     */
    private Result askTeacher(AuthUser student, Long classroomId, String rawContent) {
        String content = RELAY_PREFIX + rawContent;
        /*
          학년별로 수업이 여럿 열려 있을 수 있다(V31). **이 아이의 학년 수업**으로 보낸다 —
          아무거나 집으면 1학년 아이의 질문이 3학년 수업 선생님 화면에 뜬다.
          학년이 맞는 수업이 없으면 학급 전체 수업(grade == null)으로 내려간다.
        */
        Short myGrade = userRepository.findById(student.id()).map(User::getGrade).orElse(null);
        List<LiveSession> openSessions =
                liveSessionRepository.findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(classroomId);
        Optional<LiveSession> open = openSessions.stream()
                .filter(s -> s.getGrade() != null && s.getGrade().equals(myGrade))
                .findFirst()
                .or(() -> openSessions.stream().filter(s -> s.getGrade() == null).findFirst());
        if (open.isPresent()) {
            try {
                chatRouterService.routeStudentMessage(open.get().getId(), student.id(), content);
                return Result.delivered(Delivery.SESSION_ROUTED);
            } catch (RuntimeException e) {
                // 수업이 방금 끝났거나 라우팅이 실패해도 질문은 전달돼야 한다 — 쪽지로 내려간다
                log.warn("수업 채팅 라우팅 실패 — 쪽지로 대체한다. classroomId={}", classroomId, e);
            }
        }
        Long teacherId = memberRepository
                .findFirstByClassroomIdAndRole(classroomId, ClassroomRole.OWNER)
                .map(member -> member.getUser().getId())
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "no-teacher-in-classroom",
                        "이 학급에 담당 선생님이 없어 질문을 전달할 수 없습니다."));
        directChatService.send(student, classroomId, new DirectMessageRequest(teacherId, content));
        return Result.delivered(Delivery.DIRECT_MESSAGE);
    }

    private Result showMaterial(Long classroomId, Long materialId) {
        // 제안할 때 확인했지만 그 사이 삭제·상태 변경이 있을 수 있어 실행 시점에 다시 본다
        Material material = findOfferable(classroomId, materialId)
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "material-not-available",
                        "이 자료는 지금 열 수 없어요."));
        return Result.material(material);
    }
}
