package com.mallang.tutor.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.tutor.dto.TutorDtos.ActionDecisionRequest;
import com.mallang.tutor.dto.TutorDtos.ActionDecisionRequest.Decision;
import com.mallang.tutor.dto.TutorDtos.ActionResultResponse;
import com.mallang.tutor.dto.TutorDtos.AnswerResponse;
import com.mallang.tutor.dto.TutorDtos.AskRequest;
import com.mallang.tutor.dto.TutorDtos.FlaggedStudentResponse;
import com.mallang.tutor.dto.TutorDtos.TutorMessageResponse;
import com.mallang.tutor.entity.AiTutorMemory;
import com.mallang.tutor.entity.AiTutorMessage;
import com.mallang.tutor.entity.AiTutorMessage.AnsweredBy;
import com.mallang.tutor.entity.TutorActionStatus;
import com.mallang.tutor.repository.AiTutorMemoryRepository;
import com.mallang.tutor.repository.AiTutorMessageRepository;
import com.mallang.tutor.service.TutorActionExecutor.Result;
import com.mallang.tutor.service.TutorReply.ProposedAction;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * AI 말랑이 — 학생 질문 챗봇 (명세 §11.1 #1).
 *
 * <p>명세에 올라온 적 없던 기능이라 정책을 함께 정했다. 스펙 선행이 필요하다고 적혀 있던
 * 세 가지에 대한 결정은 이렇다:</p>
 *
 * <ul>
 *   <li><b>대화 이력</b> — 남긴다. 저학년이 쓰는 챗봇이라 무엇을 묻고 무엇을 답했는지
 *       선생님이 확인할 수 있어야 하고, 비용 추적의 근거도 된다. 원문 스레드는 이어붙이지 않되,
 *       짧은 <b>요약 한 덩어리</b>({@link AiTutorMemory})만 학급+학생당 하나 이어 다니며 문맥을 살린다
 *       — 크기가 일정해 토큰 비용이 눌리고, 요약 단계에서 지시문을 걸러 프롬프트 주입을 막는다.</li>
 *   <li><b>참고 자료</b> — 선생님이 그 학급에 올린 학습자료 중 질문과 관련된 문단만
 *       {@link TutorMaterialGrounding} 으로 골라 붙인다. 있으면 그 내용을 바탕으로, 없으면 일반 지식으로 답한다.</li>
 *   <li><b>비용 상한</b> — 학생당 하루 {@link AiTutorQuota#DAILY_LIMIT}회. 크레딧이 무제한이 아니다.</li>
 * </ul>
 *
 * <p>LLM 호출은 트랜잭션 밖에서 한다 — 왕복 동안 DB 커넥션을 쥐면 한 반이 동시에 물어볼 때
 * 커넥션 풀이 마른다. 요약 갱신도 답변을 막지 않도록 베스트에포트로 처리한다(실패해도 답은 나간다).</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiTutorService {

    /** 키가 없거나 호출이 실패했을 때. 에러로 막지 않고 갈 곳을 알려 준다. */
    private static final String FALLBACK =
            "지금은 말랑이가 대답하기 어려워요. 선생님께 여쭤보면 더 잘 알려주실 거예요!";

    /**
     * 제안의 유효기간. 어제 받은 제안을 오늘 눌러 질문이 선생님에게 가면 맥락이 어긋난다.
     * 하루로 잡은 이유는 학교 생활의 단위가 하루이기 때문이다.
     */
    private static final Duration ACTION_TTL = Duration.ofHours(24);

    /** 이보다 오래된 요약은 지금 대화의 문맥이 아니다 — 어제 이야기가 오늘 답을 끌고 가면 안 된다 */
    private static final Duration MEMORY_TTL = Duration.ofHours(24);

    private final AssignmentAccessGuard accessGuard;
    private final AiTutorClient tutorClient;
    private final AiTutorQuota quota;
    private final TutorSafetyFilter safetyFilter;
    private final AiTutorMessageRepository messageRepository;
    private final AiTutorMemoryRepository memoryRepository;
    private final TutorMaterialGrounding grounding;
    private final UserRepository userRepository;
    private final TutorActionExecutor actionExecutor;
    private final TutorMemoryUpdater memoryUpdater;

    public AnswerResponse ask(AuthUser user, AskRequest request) {
        if (user.isTeacher()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "students-only",
                    "말랑이는 학생을 위한 기능입니다.");
        }
        accessGuard.requireMember(request.classroomId(), user.id());
        // 상한을 먼저 본다 — 통과시킨 뒤 세면 크레딧이 이미 나간 뒤다.
        quota.check(user.id());

        // 초등학생 대상이라 명백한 욕설은 LLM 에 닿기 전에 막는다. 막힌 말도 기록은 남겨
        // 선생님이 확인할 수 있게 하되, LLM 은 부르지 않고 요약에도 접지 않는다.
        Optional<String> blocked = safetyFilter.blockedMessage(request.question());
        if (blocked.isPresent()) {
            // 막힌 말에는 제안도 붙지 않는다 — LLM 을 부르지 않았으니 제안할 것도 없다
            return AnswerResponse.of(record(user, request, blocked.get(), AnsweredBy.BLOCKED, null));
        }

        /*
          지금까지의 요약(있으면)과 질문 관련 자료를 함께 참고해 답한다.

          **너무 오래된 요약은 쓰지 않는다.** 어제 국어를 묻던 아이가 오늘 수학을 물으면
          "받침을 궁금해했다"가 문맥으로 붙어 답이 그쪽으로 끌려간다. 하루가 학교 생활의
          단위이므로 그 이상 지난 요약은 지금 대화의 문맥이 아니다(제안 유효기간과 같은 기준).
          지우지는 않는다 — 다음 대화에서 새로 덮인다.
        */
        String priorSummary = memoryRepository
                .findByClassroomIdAndStudentId(request.classroomId(), user.id())
                .filter(memory -> memory.getUpdatedAt() != null
                        && memory.getUpdatedAt().isAfter(LocalDateTime.now().minus(MEMORY_TTL)))
                .map(AiTutorMemory::getSummary)
                .orElse(null);
        String materials = grounding.contextFor(request.classroomId(), request.question());

        TutorReply reply = tutorClient.ask(request.question(), priorSummary, materials,
                recentTurns(request.classroomId(), user.id()));
        AnsweredBy answeredBy = reply == null ? AnsweredBy.TEMPLATE : AnsweredBy.LLM;
        String finalAnswer = reply == null ? FALLBACK : reply.answer();
        if (answeredBy == AnsweredBy.TEMPLATE) {
            // 크레딧을 안 썼으니 횟수도 돌려준다 — 안 그러면 AI 가 죽은 날 아이가 답 한 번 못 받고 잠긴다
            quota.refund(user.id());
        }

        // 폴백도 기록한다 — 무엇을 물었는지가 남아야 안전 확인이 된다.
        AiTutorMessage saved = record(user, request, finalAnswer, answeredBy,
                reply == null ? null : reply.action());
        /*
          실제 대화(LLM 답)만 요약에 반영한다 — 폴백 안내 문구는 문맥이 아니다.

          **뒤에서 돌린다.** 예전에는 여기서 요약 LLM 왕복이 끝나기를 기다린 뒤에야 답이
          나갔다 — 이 클래스 주석이 "답을 막지 않는다"고 말하면서 실제로는 막고 있었다.
          요약은 다음 질문 때나 쓰이는 값이라 이번 응답이 기다릴 이유가 없다.
          (@Async 는 프록시를 타야 하므로 반드시 다른 빈이어야 한다 — TutorMemoryUpdater)
        */
        if (answeredBy == AnsweredBy.LLM) {
            try {
                memoryUpdater.update(request.classroomId(), user.id(),
                        request.question(), finalAnswer);
            } catch (RuntimeException e) {
                // 요약 전용 실행기는 큐가 차면 거절한다(AbortPolicy). 답은 이미 만들어졌으므로
                // 그 예외가 아이에게 전달되면 안 된다 — 요약 한 번을 건너뛰는 편이 낫다.
                log.warn("말랑이 요약 갱신을 넘기지 못했다 — 이번 대화는 요약에서 빠진다. studentId={}",
                        user.id(), e);
            }
        }
        return AnswerResponse.of(saved);
    }

    /** 리포지토리 자체 트랜잭션으로 저장한다 — 저장은 짧고, 감싸 봐야 LLM 왕복만 끌어들인다. */
    private AiTutorMessage record(AuthUser user, AskRequest request, String answer,
                                  AnsweredBy answeredBy, ProposedAction action) {
        AiTutorMessage message = AiTutorMessage.of(
                accessGuard.findClassroom(request.classroomId()),
                userRepository.getReferenceById(user.id()),
                request.question(),
                answer,
                answeredBy);
        attachAction(message, request.classroomId(), action);
        /*
          살펴봐야 할 대화인지 표시한다 — 막지 않는다.

          시스템 프롬프트는 아이에게 "믿을 수 있는 어른과 나눠 줘"라고 말하는데, 정작
          어른에게 알리는 경로가 없었다. 복식학급은 교사 한 명이 여러 학년을 보고, 담임이
          20명의 대화를 매일 훑어보는 것은 비현실적이다.

          답변은 이미 만들어져 있고 여기서 바뀌지 않는다. 아이 화면은 그대로다.
          차단 경로(BLOCKED)에서도 검사한다 — 욕과 함께 털어놓는 경우가 있다.
        */
        safetyFilter.concernSignal(request.question()).ifPresent(reason -> {
            message.flagForTeacher(reason);
            log.info("살펴볼 대화로 표시했다. classroomId={} studentId={} reason={}",
                    request.classroomId(), user.id(), reason);
        });
        return messageRepository.save(message);
    }

    /** 한 턱에서 잘라 실을 최대 글자 수 — 문맥은 살리되 토큰이 무한정 늘지 않게 한다 */
    private static final int MAX_TURN_QUESTION = 300;
    private static final int MAX_TURN_ANSWER = 500;

    /**
     * 다음 답변에 실을 최근 대화 — <b>오래된 것부터</b>.
     *
     * <p>요약만으로는 "그거 다시 설명해줘" 가 성립하지 않는다. 요약은 사실 몇 줄로 줄어든 것이라
     * 직전 답변의 문장·예시를 되짚을 수 없기 때문이다. 요약은 오래된 것을, 이 턱들은 방금 것을 맡는다.</p>
     *
     * <p>지금 질문은 아직 저장 전이라(record 는 LLM 호출 뒤에 부른다) 자기 자신이 섞이지 않는다.</p>
     */
    private List<AiTutorClient.Turn> recentTurns(Long classroomId, Long studentId) {
        List<AiTutorMessage> latestFirst = messageRepository
                .findTop3ByClassroomIdAndStudentIdAndAnsweredByOrderByCreatedAtDesc(
                        classroomId, studentId, AnsweredBy.LLM);
        List<AiTutorClient.Turn> turns = new ArrayList<>(latestFirst.size());
        for (int i = latestFirst.size() - 1; i >= 0; i--) { // 시간순으로 뒤집는다
            AiTutorMessage m = latestFirst.get(i);
            turns.add(new AiTutorClient.Turn(
                    clip(m.getQuestion(), MAX_TURN_QUESTION), clip(m.getAnswer(), MAX_TURN_ANSWER)));
        }
        return turns;
    }

    private String clip(String text, int max) {
        if (text == null) {
            return "";
        }
        return text.length() <= max ? text : text.substring(0, max);
    }

    /** 제안을 붙인다. 지금 만들어지는 것은 ASK_TEACHER 하나뿐이다(아래 SHOW_MATERIAL 주석 참고). */
    private void attachAction(AiTutorMessage message, Long classroomId, ProposedAction action) {
        if (action == null) {
            return;
        }
        LocalDateTime expiresAt = LocalDateTime.now().plus(ACTION_TTL);
        switch (action.type()) {
            case ASK_TEACHER -> message.proposeAskTeacher(action.title(), action.content(), expiresAt);
            /*
              SHOW_MATERIAL 은 더 이상 만들어지지 않는다(AiTutorClient.parseAction 주석 참고).
              학생 화면에 버튼이 없어 아이가 열 수 없는 제안이었다. 이미 저장된 PENDING 행은
              TutorActionExecutor 가 그대로 실행해 준다 — 여기는 생성 경로일 뿐이다.
            */
            case SHOW_MATERIAL -> { }
        }
    }

    /** 제안 확인/거절. 확인이면 그 자리에서 실행한다. */
    public ActionResultResponse decideAction(AuthUser user, Long messageId,
                                             ActionDecisionRequest request) {
        AiTutorMessage message = loadOwnPendingAction(user, messageId);
        if (request.decision() == Decision.REJECT) {
            messageRepository.updateActionStatus(messageId, TutorActionStatus.REJECTED);
            return ActionResultResponse.rejected(message);
        }
        // 실행이 실패하면 상태를 PENDING 으로 남긴다 — 아이가 다시 시도할 수 있어야 한다
        Result result = actionExecutor.execute(user, message);
        messageRepository.updateActionStatus(messageId, TutorActionStatus.CONFIRMED);
        return ActionResultResponse.confirmed(message, result);
    }

    /**
     * 본인의, 아직 대기 중이고, 만료되지 않은 제안만 실행할 수 있다.
     *
     * <p>트랜잭션 밖에서 부르지만 안전하다 — 여기서 만지는 것은 전부 이 행의 칼럼이고,
     * 연관 엔티티는 식별자 getter 만 읽어 프록시를 깨우지 않는다.</p>
     */
    private AiTutorMessage loadOwnPendingAction(AuthUser user, Long messageId) {
        AiTutorMessage message = messageRepository.findById(messageId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "tutor-message-not-found",
                        "대화를 찾을 수 없습니다."));
        if (!message.getStudent().getId().equals(user.id())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "tutor-action-forbidden",
                    "본인의 제안만 결정할 수 있습니다.");
        }
        if (!message.hasPendingAction()) {
            throw new ApiException(HttpStatus.CONFLICT, "no-pending-action",
                    "이미 처리했거나 제안이 없는 대화입니다.");
        }
        if (message.isActionExpired(LocalDateTime.now())) {
            throw new ApiException(HttpStatus.CONFLICT, "action-expired",
                    "시간이 지나 이 제안은 더 이상 할 수 없어요. 다시 물어봐 줄래?");
        }
        return message;
    }

    /**
     * 학급에서 살펴봐야 할 대화가 있는 학생 목록 — 선생님만.
     *
     * <p>학생 본인에게는 열지 않는다. 자기 대화가 "표시됐다"는 것을 아이가 알면 다음부터
     * 털어놓지 않는다. 이 기능이 있는 이유 자체가 사라진다.
     */
    @Transactional(readOnly = true)
    public List<FlaggedStudentResponse> flaggedStudents(AuthUser viewer, Long classroomId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, viewer.id());
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "tutor-flags-forbidden",
                    "학급 선생님만 볼 수 있습니다.");
        }
        return messageRepository.countFlaggedByClassroom(classroomId).stream()
                .map(view -> new FlaggedStudentResponse(view.getStudentId(), view.getFlagged()))
                .toList();
    }

    /** 대화 기록 — 학급 선생님(안전 확인) 또는 본인(복습). */
    @Transactional(readOnly = true)
    public List<TutorMessageResponse> history(AuthUser viewer, Long classroomId, Long studentId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, viewer.id());
        if (!role.canManage() && !viewer.id().equals(studentId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "tutor-history-forbidden",
                    "본인 또는 학급 선생님만 볼 수 있습니다.");
        }
        boolean forTeacher = role.canManage();
        return messageRepository
                .findByClassroomIdAndStudentIdOrderByCreatedAtDesc(classroomId, studentId).stream()
                .map(message -> TutorMessageResponse.from(message, forTeacher))
                .toList();
    }
}
