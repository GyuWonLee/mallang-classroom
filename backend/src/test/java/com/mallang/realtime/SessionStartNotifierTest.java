package com.mallang.realtime;


import com.mallang.classroom.repository.ClassroomMemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SessionStartNotifierTest {

    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock SimpMessagingTemplate messagingTemplate;

    private SessionStartNotifier notifier;

    @BeforeEach
    void setUp() {
        notifier = new SessionStartNotifier(classroomMemberRepository, messagingTemplate);
    }

    /**
     * 학급 전원 — 학생도, <b>동료 선생님도</b>.
     *
     * <p>예전에는 시작한 사람과 학생만 받았다. 그래서 같은 학급의 다른 선생님 화면은 새로
     * 고치기 전까지 '수업 가능'인 채로 있었고, 복식학급에서는 옆에서 수업이 열린 줄 모른 채
     * 자기도 열려고 하게 된다.</p>
     */
    @Test
    void notifiesEveryoneInTheClassroomIncludingOtherTeachers() {
        // 학생 둘(11·12) + 동료 선생님 하나(3). 시작한 사람은 1
        when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(eq(2L), any()))
                .thenReturn(List.of(11L, 12L, 3L));

        notifier.notifyStarted(2L, 10L, 1L);

        verify(messagingTemplate).convertAndSendToUser(eq("1"), eq("/sub/notifications"), any());
        verify(messagingTemplate).convertAndSendToUser(eq("11"), eq("/sub/notifications"), any());
        verify(messagingTemplate).convertAndSendToUser(eq("12"), eq("/sub/notifications"), any());
        verify(messagingTemplate).convertAndSendToUser(eq("3"), eq("/sub/notifications"), any());
    }

    /** 조회에 쓰는 학급 id 를 사람 id 로 착각해 보내지 않는다 (2L 은 classroomId 다). */
    @Test
    void doesNotMistakeClassroomIdForAUser() {
        when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(eq(2L), any()))
                .thenReturn(List.of(11L, 12L));

        notifier.notifyStarted(2L, 10L, 1L);

        verify(messagingTemplate, never())
                .convertAndSendToUser(eq("2"), eq("/sub/notifications"), any());
    }

    /** 종료도 같은 사람들에게 간다 — 수업 토픽 방송은 그 방에 있던 사람만 받는다. */
    @Test
    void endNotifiesTheSamePeople() {
        when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(eq(2L), any()))
                .thenReturn(List.of(11L, 3L));

        notifier.notifyEnded(2L, 10L, 1L);

        verify(messagingTemplate).convertAndSendToUser(eq("1"), eq("/sub/notifications"), any());
        verify(messagingTemplate).convertAndSendToUser(eq("11"), eq("/sub/notifications"), any());
        verify(messagingTemplate).convertAndSendToUser(eq("3"), eq("/sub/notifications"), any());
    }
}
