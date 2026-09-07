package com.mallang.chat.service;

import com.mallang.chat.entity.ChatMessage;
import com.mallang.chat.repository.ChatMessageRepository;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.service.PresenceService;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 프레즌스 + 배정(sticky) 라우터 — 명세 v0.6 섹션 6.
 * 학생↔선생님 1:1 배정을 유지하고, 선생님 부재 시 대기열에 세웠다가 한가해지는 순간 푸시 연결.
 * DB 저장은 어떤 경우든 항상. 배정·대기열은 Redis(휘발, 유실 시 재라우팅으로 복구).
 */
@Service
@RequiredArgsConstructor
public class ChatRouterService {

    private static final String WAITING_QUEUE = "chat:waiting";
    private static final String WAITING_MEMBERS = "chat:waiting:members"; // 중복 등록 방지용 SET
    private static final String PERSONAL_DESTINATION = "/sub/notifications";

    private final PresenceService presenceService;
    private final StringRedisTemplate redis;
    private final SimpMessagingTemplate messagingTemplate;
    private final ChatMessageRepository chatMessageRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final UserRepository userRepository;
    private final ClassroomMemberRepository memberRepository;

    private String studentAssignKey(Long studentId) { return "chat:assign:student:" + studentId; }
    private String teacherAssignKey(Long teacherId) { return "chat:assign:teacher:" + teacherId; }
    private String pendingKey(Long studentId) { return "chat:pending:" + studentId; }

    /** 학생 메시지 진입점 — 진행중 수업 검증 → 배정 확인 → 라우팅 규칙 1·2 → 실패 시 대기열(규칙 3) */
    @Transactional
    public void routeStudentMessage(Long sessionId, Long studentId, String content) {
        LiveSession session = requireOpenSession(sessionId);
        // 학생 메시지는 수신자를 적지 않는다 — 이 시점에 받을 선생님이 정해지지 않았을 수
        // 있고(대기열), 자기 메시지는 sender 로 이미 찾을 수 있어 잃어버릴 일이 없다.
        saveMessage(session, studentId, null, content, null);

        String assigned = redis.opsForValue().get(studentAssignKey(studentId));
        if (assigned != null) {
            deliverChat(Long.valueOf(assigned), sessionId, studentId, content);
            return;
        }
        Optional<Long> teacher = presenceService.teacherInStudentTeam(sessionId, studentId)
                .or(() -> presenceService.anyFreeTeacher(teachersOf(session)));
        if (teacher.isPresent()) {
            assign(studentId, teacher.get());
            notifyStudent(studentId, StompEventType.CHAT_ASSIGNED,
                    Map.of("teacherId", teacher.get()));
            deliverChat(teacher.get(), sessionId, studentId, content);
        } else {
            // 규칙 3: 대기열 등록 + 메시지는 pending에 쌓아뒀다 배정 순간 일괄 전달.
            // 중복 등록 방지는 SADD의 원자성으로 — 신규 등록(1)일 때만 번호표 발급
            Long newlyQueued = redis.opsForSet().add(WAITING_MEMBERS, String.valueOf(studentId));
            if (newlyQueued != null && newlyQueued > 0) {
                redis.opsForList().leftPush(WAITING_QUEUE, String.valueOf(studentId));
            }
            redis.opsForList().leftPush(pendingKey(studentId), sessionId + ":" + content);
            notifyStudent(studentId, StompEventType.CHAT_WAITING,
                    Map.of("message", "지금 응답 가능한 선생님이 없어 대기 중입니다"));
        }
    }

    /**
     * 교사 답장 — 배정된 쌍인지, 그리고 <b>같은 학급인지</b> 검증 후 학생 사물함으로.
     *
     * <p>배정만 확인하면 부족하다. 배정은 Redis 에 남는 휘발 상태이고, 학급에서 제외된
     * 선생님이나(구성원 행은 soft delete 로 지워지지만 Redis 키는 그대로다) 옛 배정이
     * 남은 선생님이 계속 답장할 수 있다. 아이가 쓴 글이 오갈 상대는 그 반 선생님뿐이다.
     */
    @Transactional
    public void routeTeacherReply(Long sessionId, Long teacherId, Long studentId,
                                  String content, Long replyToId) {
        LiveSession session = requireOpenSession(sessionId);
        String assigned = redis.opsForValue().get(studentAssignKey(studentId));
        if (assigned == null || !assigned.equals(String.valueOf(teacherId))) {
            throw new IllegalStateException("이 학생과 배정된 대화가 없습니다");
        }
        if (!memberRepository.shareClassroom(teacherId, studentId)) {
            throw new IllegalStateException("이 학생과 같은 학급이 아닙니다");
        }
        /*
          수신자를 적는다. 여기서 studentId 는 배정과 학급 확인을 모두 지난 값이다.

          예전에는 이 인자를 저장에 넘기지 않아, 답장이 아닌 교사 메시지(replyToId 없이 발행된
          것)가 DB 에서 어떤 학생과도 이어지지 않았다. 실시간으로는 전달되니 그 순간엔 보이지만
          새로고침하면 사라졌다 — 학생의 /me/messages 에도, 선생님의 스레드 조회에도 안 걸렸다.
          그리고 프론트가 replyToId 유무로 발신자 역할을 되짚고 있어서, 남아 있는 목록에서는
          선생님 말이 학생 말풍선으로 뜬다.
        */
        saveMessage(session, teacherId, studentId, content, replyToId);
        messagingTemplate.convertAndSendToUser(String.valueOf(studentId), PERSONAL_DESTINATION,
                StompEnvelope.of(StompEventType.CHAT_REPLY,
                        Map.of("from", teacherId, "content", content)));
    }

    /**
     * 선생님이 한가해진 순간 호출 (웹훅: 팀 룸 퇴장 / STOMP: 접속) — 대기열 FIFO 해소.
     *
     * 대기열을 **전부** 이 선생님에게 배정한다. 한 명씩 나눠 갖는 게 아니라 통째로 가져간다 —
     * 배정이 1:N 구조(chat:assign:teacher:{id} 가 SET)이고, 기다리는 학생을 다음 선생님이
     * 올 때까지 남겨두는 것보다 지금 응답 가능한 사람에게 전부 붙이는 편이 낫다는 팀 결정이다.
     * 버그가 아니므로 while 루프를 단건 pop 으로 바꾸지 말 것 (ChatRouterServiceTest 가 고정).
     */
    public void drainWaitingQueue(Long teacherId) {
        // 다른 반 학생은 도로 넣는다 — 큐에서 꺼내며 순회해야 하므로 끝나고 한 번에 되돌린다.
        List<String> notMine = new java.util.ArrayList<>();
        String studentId;
        while ((studentId = redis.opsForList().rightPop(WAITING_QUEUE)) != null) {
            Long sid = Long.valueOf(studentId);
            if (!isStudentOfMyOpenSession(teacherId, sid)) {
                notMine.add(studentId);
                continue;
            }
            redis.opsForSet().remove(WAITING_MEMBERS, studentId);
            assign(sid, teacherId);
            notifyStudent(sid, StompEventType.CHAT_ASSIGNED, Map.of("teacherId", teacherId));
            String pending;
            while ((pending = redis.opsForList().rightPop(pendingKey(sid))) != null) {
                int sep = pending.indexOf(':');
                deliverChat(teacherId, Long.valueOf(pending.substring(0, sep)),
                        sid, pending.substring(sep + 1));
            }
        }
        if (!notMine.isEmpty()) {
            /*
              꺼낸 순서(오래된 것부터)의 역순으로 오른쪽에 붙여야 원래 자리로 돌아간다.
              leftPush 로 넣고 rightPop 으로 꺼내는 큐이므로, 오른쪽 끝이 가장 오래 기다린
              학생이다. 뒤집지 않고 그대로 넣으면 기다린 순서가 뒤집힌다.
            */
            java.util.Collections.reverse(notMine);
            redis.opsForList().rightPushAll(WAITING_QUEUE, notMine);
        }
    }

    /**
     * 대기열에서 이 선생님이 데려가도 되는 학생인가 — <b>내가 지금 진행 중인 수업의 학생만</b>.
     *
     * <p>예전 기준은 {@code shareClassroom} 이었다: 학급을 하나라도 같이 쓰면 데려갔다.
     * 학급에 수업이 하나뿐이던 시절엔 맞는 말이었지만, 학년별로 수업이 갈린 지금은(V31)
     * <b>수업에 들어가지도 않은 동료 선생님이 소켓에 접속만 해도</b> 남의 수업 학생을
     * 통째로 가져간다(이 메서드를 부르는 곳이 STOMP 접속 이벤트다). 실제로 그렇게 되고 있었다.</p>
     *
     * <p>학년까지 본다. 같은 학급이어도 1학년 수업을 맡은 선생님이 3학년 아이를 데려가면
     * 안 된다. 학년 없는 수업(= 학급 전체)은 그 학급 학생 전부가 자기 학생이다.</p>
     */
    private boolean isStudentOfMyOpenSession(Long teacherId, Long studentId) {
        for (LiveSession session : liveSessionRepository
                .findAllByStartedByIdAndEndedAtIsNull(teacherId)) {
            boolean sameClassroom = memberRepository
                    .findByClassroomIdAndUserId(session.getClassroom().getId(), studentId)
                    .isPresent();
            if (!sameClassroom) {
                continue;
            }
            if (session.getGrade() == null) {
                return true;
            }
            Short grade = userRepository.findById(studentId)
                    .map(com.mallang.user.entity.User::getGrade)
                    .orElse(null);
            if (session.getGrade().equals(grade)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 배정 후보 — <b>이 수업을 진행 중인 선생님 한 명</b>.
     *
     * <p>예전에는 그 학급의 OWNER/MAINTAINER 전원이었다. 학급에 수업이 하나뿐이던 시절엔
     * 사실상 같은 말이었지만, 학년별로 수업이 따로 도는 지금은(V31) 아이의 질문이 <b>다른
     * 학년 수업을 하고 있는 선생님</b>에게 배정된다. 실제로 그렇게 되고 있었다 — 1학년
     * 수업 중인 아이의 말이 3학년 수업 선생님 화면에 떴다.</p>
     *
     * <p>수업에 들어갈 수 있는 교사가 시작한 사람 한 명뿐이므로(SessionTicketService의
     * requireSessionTeacher) 후보도 그 한 명이 맞다. 그 선생님이 자리에 없으면 후보가
     * 없는 것이고, 아이는 대기열로 간다 — 엉뚱한 선생님에게 붙는 것보다 낫다.</p>
     */
    private List<Long> teachersOf(LiveSession session) {
        return session.getStartedBy() == null
                ? List.of()
                : List.of(session.getStartedBy().getId());
    }

    /** 배정 종료 — ⑴ 선생님 타 수업 입장(웹훅이 호출) ⑵ 하루 학급 종료(수업 종료 API에서 호출 예정) */
    public void endConversationsOf(Long teacherId) {
        Set<String> students = redis.opsForSet().members(teacherAssignKey(teacherId));
        if (students != null) {
            for (String studentId : students) {
                redis.delete(studentAssignKey(Long.valueOf(studentId)));
                notifyStudent(Long.valueOf(studentId), StompEventType.CHAT_ENDED,
                        Map.of("message", "상담이 종료되었습니다"));
            }
        }
        redis.delete(teacherAssignKey(teacherId));
    }

    /** 하루 학급(수업) 종료 시 호출 (수업 종료 API에서) — 이 수업에서 대기 중이던 학생 정리 */
    public void onSessionEnded(Long sessionId) {
        java.util.List<String> waiting = redis.opsForList().range(WAITING_QUEUE, 0, -1);
        if (waiting == null) {
            return;
        }
        for (String studentId : waiting) {
            Long sid = Long.valueOf(studentId);
            // pending의 가장 오래된 항목이 이 수업 것이면 = 이 수업에서 줄 선 학생
            String oldest = redis.opsForList().index(pendingKey(sid), -1);
            if (oldest != null && oldest.startsWith(sessionId + ":")) {
                redis.opsForList().remove(WAITING_QUEUE, 0, studentId);
                redis.opsForSet().remove(WAITING_MEMBERS, studentId);
                redis.delete(pendingKey(sid));
                notifyStudent(sid, StompEventType.CHAT_ENDED,
                        Map.of("message", "수업이 종료되어 질문 접수가 마감되었습니다"));
            }
        }
    }

    /** 메시지 발행은 진행중 수업에서만 허용 — 수업 종료 후 차단 (팀 결정, v0.7 문서 반영 예정) */
    private LiveSession requireOpenSession(Long sessionId) {
        return liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new IllegalStateException("진행 중인 수업이 아니라 메시지를 보낼 수 없습니다"));
    }

    private void assign(Long studentId, Long teacherId) {
        redis.opsForValue().set(studentAssignKey(studentId), String.valueOf(teacherId));
        redis.opsForSet().add(teacherAssignKey(teacherId), String.valueOf(studentId));
    }

    /**
     * 배정된 선생님에게 학생 질문을 배달한다.
     *
     * <p><b>보낸 아이 이름을 함께 싣는다.</b> 예전에는 id 만 보냈고 화면이 수업 참가자 명단에서
     * 이름을 되찾았는데, 그 명단은 수업을 구독해야 채워진다. 그래서 아직 명단이 안 온 순간에는
     * 토스트가 "학생 학생이 질문했어요"로 떴다 — 누가 물었는지 모르니 알림의 값이 없다.</p>
     */
    private void deliverChat(Long teacherId, Long sessionId, Long studentId, String content) {
        messagingTemplate.convertAndSendToUser(String.valueOf(teacherId), PERSONAL_DESTINATION,
                StompEnvelope.of(StompEventType.CHAT,
                        Map.of("sessionId", sessionId, "from", studentId,
                                "fromName", nameOf(studentId), "content", content)));
    }

    /** 이름을 못 찾아도 배달은 막지 않는다 — 화면이 '학생'으로 받아 준다 */
    private String nameOf(Long studentId) {
        return userRepository.findById(studentId)
                .map(com.mallang.user.entity.User::getName)
                .orElse("학생");
    }

    private void notifyStudent(Long studentId, String type, Map<String, Object> payload) {
        messagingTemplate.convertAndSendToUser(String.valueOf(studentId), PERSONAL_DESTINATION,
                StompEnvelope.of(type, payload));
    }

    /**
     * @param recipientId 받을 사람. 학생이 보낼 때는 아직 정해지지 않을 수 있어 null 이다
     *                    (대기열이 나중에 정한다). 선생님이 보낼 때는 배정으로 확정돼 있다.
     */
    private void saveMessage(LiveSession session, Long senderId, Long recipientId, String content,
                             Long replyToId) {
        ChatMessage replyTo = replyToId == null ? null
                : chatMessageRepository.getReferenceById(replyToId);
        chatMessageRepository.save(ChatMessage.of(
                session,
                userRepository.getReferenceById(senderId),
                recipientId == null ? null : userRepository.getReferenceById(recipientId),
                content,
                replyTo));
    }
}
