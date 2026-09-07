package com.mallang.session.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.team.entity.Team;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 수업 중 강퇴 — S15P11A407-137
 *
 * <p>재입장 차단(SessionTicketService#requireNotKicked)과 Redis 키(SessionRedisKeys#kicked),
 * STOMP 타입(KICKED)은 이미 있었는데 명단에 넣는 쪽이 없어 한 번도 발동하지 않았다.
 * 여기서 검증하는 핵심은 "차단 명단에 먼저 올리고 그다음 끊는다"는 순서다.</p>
 */
@ExtendWith(MockitoExtension.class)
class SessionKickServiceTest {

    private static final Long SESSION_ID = 10L;
    private static final Long CLASSROOM_ID = 5L;
    private static final Long TEACHER_ID = 1L;
    private static final Long STUDENT_ID = 20L;
    private static final Long TEAM_ID = 7L;
    private static final String KICKED_KEY = "session:10:kicked";

    @Mock SessionStarterGuard starterGuard;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock SessionParticipantRepository sessionParticipantRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock LiveKitRoomService liveKitRoomService;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock StringRedisTemplate redis;
    @Mock SetOperations<String, String> setOperations;

    private SessionKickService service;

    @BeforeEach
    void setUp() {
        service = new SessionKickService(starterGuard, liveSessionRepository,
                classroomMemberRepository, sessionParticipantRepository, teamMemberRepository,
                liveKitRoomService, messagingTemplate, redis);
        lenient().when(redis.opsForSet()).thenReturn(setOperations);
    }

    @Test
    void kicksStudentFromClassroomRoomAndTeamRoom() {
        openSession();
        studentMember();
        Optional<Team> assignedTeam = Optional.of(team());
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(assignedTeam);

        service.kick(SESSION_ID, STUDENT_ID, teacher());

        verify(starterGuard).requireStarter(SESSION_ID, teacher());
        verify(setOperations).add(KICKED_KEY, "20");
        verify(liveKitRoomService).removeParticipant(
                SessionTicketService.classroomRoomName(SESSION_ID),
                SessionTicketService.identity(false, STUDENT_ID));
        verify(liveKitRoomService).removeParticipant(
                SessionTicketService.teamRoomName(SESSION_ID, TEAM_ID),
                SessionTicketService.identity(false, STUDENT_ID));
        // 출석 기록도 닫아 준다 — 웹훅 leave 가 오지 않을 수 있다
        verify(sessionParticipantRepository).markLeft(eq(SESSION_ID), eq(STUDENT_ID), any());
    }

    @Test
    void marksKickedListBeforeDisconnecting() {
        openSession();
        studentMember();
        noTeam();

        service.kick(SESSION_ID, STUDENT_ID, teacher());

        // 순서가 뒤집히면 학생이 끊긴 직후 기존 티켓으로 재입장할 수 있다
        InOrder order = inOrder(setOperations, liveKitRoomService);
        order.verify(setOperations).add(KICKED_KEY, "20");
        order.verify(liveKitRoomService).removeParticipant(anyString(), anyString());
    }

    @Test
    void broadcastsKickedEventToTheSession() {
        openSession();
        studentMember();
        noTeam();

        service.kick(SESSION_ID, STUDENT_ID, teacher());

        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSend(eq("/sub/sessions/10"), captor.capture());
        StompEnvelope envelope = (StompEnvelope) captor.getValue();
        assertThat(envelope.type()).isEqualTo(StompEventType.KICKED);
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.payload();
        // 강퇴당한 본인은 화면을 닫고, 나머지는 명단에서 지운다
        assertThat(payload)
                .containsEntry("userId", STUDENT_ID)
                .containsEntry("by", TEACHER_ID);
    }

    @Test
    void studentWithoutTeamIsOnlyRemovedFromClassroomRoom() {
        openSession();
        studentMember();
        noTeam();

        service.kick(SESSION_ID, STUDENT_ID, teacher());

        verify(liveKitRoomService).removeParticipant(
                SessionTicketService.classroomRoomName(SESSION_ID),
                SessionTicketService.identity(false, STUDENT_ID));
        verify(liveKitRoomService, never()).removeParticipant(contains("-team-"), anyString());
    }

    @Test
    void nonStarterTeacherIsRejected() {
        doThrow(new ApiException(HttpStatus.FORBIDDEN, "not-session-teacher", "권한 없음"))
                .when(starterGuard).requireStarter(SESSION_ID, teacher());

        assertThatThrownBy(() -> service.kick(SESSION_ID, STUDENT_ID, teacher()))
                .isInstanceOf(ApiException.class);

        // 권한이 없으면 아무것도 건드리지 않는다
        verify(setOperations, never()).add(anyString(), anyString());
        verify(liveKitRoomService, never()).removeParticipant(anyString(), anyString());
    }

    @Test
    void cannotKickYourself() {
        openSession();

        assertThatThrownBy(() -> service.kick(SESSION_ID, TEACHER_ID, teacher()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("자기 자신");

        verify(setOperations, never()).add(anyString(), anyString());
    }

    @Test
    void cannotKickSomeoneOutsideTheClassroom() {
        openSession();
        when(classroomMemberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.kick(SESSION_ID, STUDENT_ID, teacher()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학급 구성원");

        verify(setOperations, never()).add(anyString(), anyString());
    }

    @Test
    void cannotKickAnotherTeacher() {
        openSession();
        Optional<ClassroomMember> otherTeacher = Optional.of(member(ClassroomRole.MAINTAINER));
        when(classroomMemberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, 2L))
                .thenReturn(otherTeacher);

        // 선생님끼리 서로 내보내는 건 수업 운영이 아니라 사고다
        assertThatThrownBy(() -> service.kick(SESSION_ID, 2L, teacher()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님");

        verify(setOperations, never()).add(anyString(), anyString());
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void openSession() {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(CLASSROOM_ID);
        LiveSession session = mock(LiveSession.class);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        lenient().when(liveSessionRepository.findByIdAndEndedAtIsNull(SESSION_ID))
                .thenReturn(Optional.of(session));
    }

    private void studentMember() {
        // 목을 미리 만들어 둔다 — when(...) 안에서 다른 목을 스텁하면 중첩 스텁이 된다
        Optional<ClassroomMember> student = Optional.of(member(ClassroomRole.STUDENT));
        when(classroomMemberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(student);
    }

    private void noTeam() {
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());
    }

    private ClassroomMember member(ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        return member;
    }

    private Team team() {
        Team team = mock(Team.class);
        lenient().when(team.getId()).thenReturn(TEAM_ID);
        return team;
    }

    private AuthUser teacher() {
        return new AuthUser(TEACHER_ID, Role.TEACHER, "김선생");
    }
}
