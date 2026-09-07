package com.mallang.session.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.SessionDtos.BoardAction;
import com.mallang.session.dto.SessionDtos.BoardGrantRequest;
import com.mallang.session.dto.SessionDtos.BoardTarget;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 판서 권한 부여/회수 — S15P11A407-109 */
@ExtendWith(MockitoExtension.class)
class BoardGrantServiceTest {

    private static final String GRANTS_KEY = "session:10:board:grants";

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock StringRedisTemplate redis;
    @Mock SetOperations<String, String> setOperations;

    private BoardGrantService service;

    @BeforeEach
    void setUp() {
        service = new BoardGrantService(liveSessionRepository, classroomMemberRepository,
                teamMemberRepository, messagingTemplate, redis);
    }

    @Test
    void grantToAllAddsEveryStudent() {
        openSessionOwnedBy(1L, ClassroomRole.OWNER);
        when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(2L,
                List.of(ClassroomRole.STUDENT))).thenReturn(List.of(11L, 12L));
        when(redis.opsForSet()).thenReturn(setOperations);

        service.updateGrants(10L, new BoardGrantRequest(
                BoardTarget.ALL, BoardAction.GRANT, null, null), teacher(1L));

        verify(setOperations).add(GRANTS_KEY, "11", "12");
        verify(messagingTemplate).convertAndSend(eq("/sub/sessions/10"), any(Object.class));
    }

    @Test
    void grantToTeamAddsTeamMembers() {
        openSessionOwnedBy(1L, ClassroomRole.MAINTAINER);
        when(teamMemberRepository.findUserIdsByTeamId(3L)).thenReturn(List.of(11L));
        when(redis.opsForSet()).thenReturn(setOperations);

        service.updateGrants(10L, new BoardGrantRequest(
                BoardTarget.TEAM, BoardAction.GRANT, 3L, null), teacher(1L));

        verify(setOperations).add(GRANTS_KEY, "11");
    }

    @Test
    void revokeFromParticipantRemovesOnlyThatStudent() {
        openSessionOwnedBy(1L, ClassroomRole.OWNER);
        ClassroomMember student = mock(ClassroomMember.class);
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 11L))
                .thenReturn(Optional.of(student));
        when(redis.opsForSet()).thenReturn(setOperations);

        service.updateGrants(10L, new BoardGrantRequest(
                BoardTarget.PARTICIPANT, BoardAction.REVOKE, null, 11L), teacher(1L));

        verify(setOperations).remove(GRANTS_KEY, (Object[]) new String[]{"11"});
        verify(setOperations, never()).add(any(), any(String[].class));
    }

    @Test
    void teamTargetWithoutTeamIdIsRejected() {
        openSessionOwnedBy(1L, ClassroomRole.OWNER);

        assertThatThrownBy(() -> service.updateGrants(10L, new BoardGrantRequest(
                BoardTarget.TEAM, BoardAction.GRANT, null, null), teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("teamId");
    }

    @Test
    void studentCannotChangeGrants() {
        openSessionOwnedBy(5L, ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service.updateGrants(10L, new BoardGrantRequest(
                BoardTarget.ALL, BoardAction.GRANT, null, null), teacher(5L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("OWNER/MAINTAINER");
    }

    @Test
    void anotherManagerCannotChangeGrantsDuringSession() {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        User starter = mock(User.class);
        when(session.getClassroom()).thenReturn(classroom);
        when(classroom.getId()).thenReturn(2L);
        when(session.getStartedBy()).thenReturn(starter);
        when(starter.getId()).thenReturn(1L);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L))
                .thenReturn(Optional.of(session));

        assertThatThrownBy(() -> service.updateGrants(10L, new BoardGrantRequest(
                BoardTarget.ALL, BoardAction.GRANT, null, null), teacher(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    @Test
    void endedSessionIsRejected() {
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.updateGrants(10L, new BoardGrantRequest(
                BoardTarget.ALL, BoardAction.GRANT, null, null), teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("진행 중인 수업");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    /** 진행 중 수업(id 10, 학급 2) + 요청자의 학급 역할 */
    private void openSessionOwnedBy(Long userId, ClassroomRole role) {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(2L);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        User starter = mock(User.class);
        lenient().when(starter.getId()).thenReturn(userId);
        lenient().when(session.getStartedBy()).thenReturn(starter);
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);

        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, userId))
                .thenReturn(Optional.of(member));
    }
}
