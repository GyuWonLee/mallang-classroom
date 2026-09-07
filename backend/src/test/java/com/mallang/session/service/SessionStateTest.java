package com.mallang.session.service;

import com.mallang.chat.service.ChatRouterService;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.SessionStartNotifier;
import com.mallang.session.dto.SessionDtos.SessionStateResponse;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SessionStateTest {

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock SessionParticipantRepository sessionParticipantRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock UserRepository userRepository;
    @Mock ChatRouterService chatRouterService;
    @Mock SessionStartNotifier sessionStartNotifier;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock StringRedisTemplate redis;
    @Mock SetOperations<String, String> setOperations;
    @Mock ListOperations<String, String> listOperations;
    @Mock Cursor<String> cursor;
    @Mock ObjectMapper objectMapper;
    @Mock LiveKitRoomService liveKitRoomService;
    @Mock SessionTopicService sessionTopicService;

    private SessionService service;

    @BeforeEach
    void setUp() {
        service = new SessionService(liveSessionRepository, sessionParticipantRepository,
                classroomMemberRepository,
                teamMemberRepository, userRepository, chatRouterService, sessionStartNotifier,
                messagingTemplate, redis, objectMapper, liveKitRoomService, sessionTopicService);
    }

    @Test
    void stateReturnsLockedBroadcastArea() {
        stubState(true);

        SessionStateResponse response = service.state(10L, student());

        assertThat(response.broadcastLocked()).isTrue();
    }

    @Test
    void stateReturnsUnlockedBroadcastArea() {
        stubState(false);

        SessionStateResponse response = service.state(10L, student());

        assertThat(response.broadcastLocked()).isFalse();
    }

    @Test
    void stateReturnsCameraLockedStudentIds() {
        stubState(false);
        when(setOperations.members(SessionRedisKeys.disabledCam(10L)))
                .thenReturn(Set.of("15", "11"));

        SessionStateResponse response = service.state(10L, student());

        assertThat(response.disabledCam()).containsExactly(11L, 15L);
    }

    @Test
    void stateReturnsTopics() {
        stubState(false);
        when(sessionTopicService.getTopics(10L))
                .thenReturn(Map.of("5", "분수의 덧셈", "6", "소수의 나눗셈"));

        SessionStateResponse response = service.state(10L, student());

        assertThat(response.topics()).containsEntry("5", "분수의 덧셈")
                .containsEntry("6", "소수의 나눗셈");
    }

    private void stubState(boolean locked) {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        ClassroomMember membership = mock(ClassroomMember.class);
        when(session.getId()).thenReturn(10L);
        when(session.getClassroom()).thenReturn(classroom);
        when(classroom.getId()).thenReturn(2L);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L))
                .thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 11L))
                .thenReturn(Optional.of(membership));

        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.members(anyString())).thenReturn(Set.of());
        when(redis.hasKey(SessionRedisKeys.broadcastLock(10L))).thenReturn(locked);
        when(redis.scan(any(ScanOptions.class))).thenReturn(cursor);
        when(redis.opsForList()).thenReturn(listOperations);
        when(listOperations.range(SessionRedisKeys.boardStrokes(10L), 0, -1))
                .thenReturn(List.of());
    }

    private AuthUser student() {
        return new AuthUser(11L, Role.STUDENT, "학생");
    }
}
