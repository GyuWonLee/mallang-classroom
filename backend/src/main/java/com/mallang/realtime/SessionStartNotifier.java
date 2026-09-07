package com.mallang.realtime;

import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 수업 시작·종료를 학급 구성원 전원의 개인 사물함으로 푸시.
 *
 * <p>"로그인 즉시 STOMP 연결" 전략의 결실 — 대시보드에 있던 학생에게 입장 버튼이 뜨게 한다.</p>
 *
 * <p><b>동료 선생님도 받는다.</b> 예전에는 시작한 사람과 학생만 받아서, 같은 학급의 다른
 * 선생님 화면은 새로 고치기 전까지 '수업 가능'인 채로 있었다. 복식학급처럼 선생님이 둘 이상인
 * 학급에서는 옆에서 수업이 열린 것을 모른 채 자기도 열려고 하게 된다.</p>
 */
@Component
@RequiredArgsConstructor
public class SessionStartNotifier {

    private final ClassroomMemberRepository classroomMemberRepository;
    private final SimpMessagingTemplate messagingTemplate;

    private static final List<ClassroomRole> EVERYONE = List.of(
            ClassroomRole.STUDENT, ClassroomRole.OWNER, ClassroomRole.MAINTAINER);

    public void notifyStarted(Long classroomId, Long sessionId, Long startedById) {
        push(classroomId, StompEventType.SESSION_STARTED,
                Map.of("sessionId", sessionId, "classroomId", classroomId), startedById);
    }

    /**
     * 수업이 끝났음을 학급 전원에게.
     *
     * <p>종료는 이미 수업 토픽으로도 나가지만(SessionService), 그건 <b>그 방에 있던 사람</b>만
     * 받는다. 학급 화면에서 카드만 보고 있던 동료 선생님은 아무것도 못 받아, 끝난 수업이
     * 계속 '수업중'으로 남아 있었다 — 시작과 같은 이유로 개인 채널에도 보낸다.</p>
     */
    public void notifyEnded(Long classroomId, Long sessionId, Long endedById) {
        push(classroomId, StompEventType.SESSION_ENDED,
                Map.of("sessionId", sessionId, "classroomId", classroomId), endedById);
    }

    /**
     * 학급 구성원 전원 + 행위자에게 개인 채널로 보낸다.
     *
     * <p>행위자를 따로 넣는 이유는 그가 아직 멤버 조회에 안 잡히는 경우를 위해서가 아니라,
     * 집합으로 중복을 지우기 위해서다 — 두 번 받으면 화면이 두 번 갱신된다.</p>
     */
    private void push(Long classroomId, String event, Map<String, Object> payload, Long actorId) {
        Set<Long> recipients = new LinkedHashSet<>();
        recipients.add(actorId);
        recipients.addAll(
                classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(classroomId, EVERYONE));

        for (Long userId : recipients) {
            messagingTemplate.convertAndSendToUser(String.valueOf(userId), "/sub/notifications",
                    StompEnvelope.of(event, payload));
        }
    }
}
