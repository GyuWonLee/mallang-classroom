package com.mallang.session.controller;

import com.mallang.chat.service.ChatRouterService;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.session.service.LiveKitWebhookVerifier;
import com.mallang.session.service.MediaControlService;
import com.mallang.session.service.PresenceService;
import com.mallang.session.service.SessionService;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.Optional;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LiveKitWebhookControllerTest {

    @Mock PresenceService presenceService;
    @Mock ChatRouterService chatRouterService;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock SessionParticipantRepository sessionParticipantRepository;
    @Mock UserRepository userRepository;
    @Mock LiveKitWebhookVerifier webhookVerifier;
    @Mock MediaControlService mediaControlService;
    @Mock SessionService sessionService;

    private LiveKitWebhookController controller;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = JsonMapper.builder().build();
        controller = new LiveKitWebhookController(
                presenceService,
                chatRouterService,
                liveSessionRepository,
                sessionParticipantRepository,
                userRepository,
                webhookVerifier,
                mediaControlService,
                sessionService,
                objectMapper);
    }

    @Test
    void studentTeamRoomJoinReappliesMediaLocksBeforePresenceUpdate() {
        String body = """
                {
                  "event": "participant_joined",
                  "room": {"name": "session-10-team-3"},
                  "participant": {"identity": "student-11"}
                }
                """;

        controller.handle("Bearer signed-webhook", body);

        verify(webhookVerifier).verify("Bearer signed-webhook", body);
        verify(mediaControlService).reapplyMediaLocksOnJoin(
                10L, "session-10-team-3", 11L);
        verify(presenceService).studentEnteredTeamRoom(10L, 3L, 11L);
    }

    /**
     * 팀 순회는 상담을 끊지 않는다 — S15P11A407-132.
     * A팀 퇴장(drain 으로 대기 학생 배정) 직후 B팀 입장에서 종료해 버리면,
     * 학생이 CHAT_ASSIGNED 받자마자 CHAT_ENDED 를 받고 대기열에서도 빠진다.
     */
    @Test
    void movingBetweenTeamsInSameSessionKeepsConversations() {
        when(presenceService.lastSessionOfTeacher(1L)).thenReturn(Optional.of(10L));

        controller.handle("Bearer signed-webhook", teacherJoins("session-10-team-5", 1L));

        verify(chatRouterService, never()).endConversationsOf(1L);
        verify(presenceService).teacherEnteredTeamRoom(10L, 5L, 1L);
    }

    /** 배정 종료 규칙 ⑵ 는 유지된다 — 다른 수업으로 넘어가면 기존 대화를 끊는다. */
    @Test
    void enteringAnotherSessionEndsConversations() {
        when(presenceService.lastSessionOfTeacher(1L)).thenReturn(Optional.of(10L));

        controller.handle("Bearer signed-webhook", teacherJoins("session-20-team-5", 1L));

        verify(chatRouterService).endConversationsOf(1L);
        verify(presenceService).teacherEnteredTeamRoom(20L, 5L, 1L);
    }

    /** 첫 입장은 끊을 대화가 없다 — 없는 상태를 "다르다"로 읽으면 안 된다. */
    @Test
    void firstEverTeamRoomJoinEndsNothing() {
        when(presenceService.lastSessionOfTeacher(1L)).thenReturn(Optional.empty());

        controller.handle("Bearer signed-webhook", teacherJoins("session-10-team-5", 1L));

        verify(chatRouterService, never()).endConversationsOf(1L);
        verify(presenceService).teacherEnteredTeamRoom(10L, 5L, 1L);
    }

    /** 퇴장 쪽은 그대로 — 한가해진 순간 대기열을 가져간다. */
    @Test
    void leavingTeamRoomStillDrainsWaitingQueue() {
        String body = """
                {
                  "event": "participant_left",
                  "room": {"name": "session-10-team-5"},
                  "participant": {"identity": "teacher-1"}
                }
                """;

        controller.handle("Bearer signed-webhook", body);

        verify(presenceService).teacherLeftTeamRoom(10L, 5L, 1L);
        verify(chatRouterService).drainWaitingQueue(1L);
    }

    private String teacherJoins(String roomName, long teacherId) {
        return """
                {
                  "event": "participant_joined",
                  "room": {"name": "%s"},
                  "participant": {"identity": "teacher-%d"}
                }
                """.formatted(roomName, teacherId);
    }

    @Test
    void mainRoomFinishedEndsTheSession() {
        // room_finished 에는 participant 필드가 없다. 예전에는 이 때문에 통째로 버려져
        // 수업이 영원히 열린 채로 남았다.
        String body = """
                {
                  "event": "room_finished",
                  "room": {"name": "session-42"}
                }
                """;

        controller.handle("Bearer x", body);

        verify(sessionService).endByRoomFinished(42L);
    }

    @Test
    void teamRoomFinishedDoesNotEndTheSession() {
        // 팀 방이 닫히는 것은 수업 종료가 아니다 — 순회 중 흔히 일어난다
        String body = """
                {
                  "event": "room_finished",
                  "room": {"name": "session-42-team-7"}
                }
                """;

        controller.handle("Bearer x", body);

        verify(sessionService, never()).endByRoomFinished(org.mockito.ArgumentMatchers.anyLong());
    }
}
