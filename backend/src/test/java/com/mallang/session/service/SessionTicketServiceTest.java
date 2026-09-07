package com.mallang.session.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.SessionDtos.JoinResponse;
import com.mallang.session.dto.SessionDtos.TeamRoomToken;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.entity.Team;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.team.repository.TeamRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SessionTicketServiceTest {

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock TeamRepository teamRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock LiveKitTokenService liveKitTokenService;
    @Mock UserRepository userRepository;
    @Mock StringRedisTemplate redis;
    @Mock SetOperations<String, String> setOperations;
    @Mock SessionTopicService sessionTopicService;

    private SessionTicketService service;

    @BeforeEach
    void setUp() {
        service = new SessionTicketService(
                liveSessionRepository,
                classroomMemberRepository,
                teamRepository,
                teamMemberRepository,
                liveKitTokenService,
                userRepository,
                redis,
                sessionTopicService);
        ReflectionTestUtils.setField(service, "liveKitPublicUrl", "wss://livekit.example.com");
    }

    @Test
    void studentJoinReturnsClassroomAndAssignedTeamTickets() {
        AuthUser authUser = new AuthUser(7L, Role.STUDENT, "Student Kim");
        LiveSession session = session(10L, 2L);
        ClassroomMember member = org.mockito.Mockito.mock(ClassroomMember.class);
        Team team = team(3L);

        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(member));
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.isMember("session:10:kicked", "7")).thenReturn(false);
        when(setOperations.isMember("session:10:media:muted-mic", "7")).thenReturn(false);
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(team));
        when(liveKitTokenService.issueRoomTicket(
                "session-10", "student-7", "Student Kim", false))
                .thenReturn("classroom-ticket");
        when(liveKitTokenService.issueRoomTicket(
                "session-10-team-3", "student-7", "Student Kim", true, null))
                .thenReturn("team-ticket");
        when(sessionTopicService.getTopics(10L))
                .thenReturn(Map.of("5", "분수의 덧셈"));

        JoinResponse response = service.join(10L, authUser);

        assertThat(response.livekitUrl()).isEqualTo("wss://livekit.example.com");
        assertThat(response.classroomRoom().token()).isEqualTo("classroom-ticket");
        assertThat(response.teamRoom())
                .isEqualTo(new TeamRoomToken("team-ticket", 3L));
        assertThat(response.topics()).containsEntry("5", "분수의 덧셈");
    }

    @Test
    void joinLoadsDisplayNameFromDbWhenTokenHasNoNameClaim() {
        // name 클레임 도입 전에 발급된 access 토큰 — displayName 이 null 로 들어온다
        AuthUser authUser = new AuthUser(7L, Role.STUDENT);
        LiveSession session = session(10L, 2L);
        ClassroomMember member = org.mockito.Mockito.mock(ClassroomMember.class);
        User user = org.mockito.Mockito.mock(User.class);

        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(member));
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.isMember("session:10:kicked", "7")).thenReturn(false);
        when(setOperations.isMember("session:10:media:muted-mic", "7")).thenReturn(false);
        when(userRepository.findById(7L)).thenReturn(Optional.of(user));
        when(user.getName()).thenReturn("Student Kim");
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.empty());
        when(liveKitTokenService.issueRoomTicket(
                "session-10", "student-7", "Student Kim", false))
                .thenReturn("classroom-ticket");

        JoinResponse response = service.join(10L, authUser);

        assertThat(response.classroomRoom().token()).isEqualTo("classroom-ticket");
        assertThat(response.teamRoom()).isNull();
    }

    @Test
    void lockedStudentReceivesTeamTicketWithoutMicrophonePublishSource() {
        AuthUser authUser = new AuthUser(7L, Role.STUDENT, "Student Kim");
        LiveSession session = session(10L, 2L);
        ClassroomMember member = org.mockito.Mockito.mock(ClassroomMember.class);
        Team team = team(3L);

        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(member));
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.isMember("session:10:kicked", "7")).thenReturn(false);
        when(setOperations.isMember("session:10:media:muted-mic", "7")).thenReturn(true);
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(team));
        when(liveKitTokenService.issueRoomTicket(
                "session-10", "student-7", "Student Kim", false))
                .thenReturn("classroom-ticket");
        when(liveKitTokenService.issueRoomTicket(
                "session-10-team-3", "student-7", "Student Kim", true,
                LiveKitTokenService.PUBLISH_SOURCES_WITHOUT_MICROPHONE))
                .thenReturn("restricted-team-ticket");

        JoinResponse response = service.join(10L, authUser);

        assertThat(response.teamRoom())
                .isEqualTo(new TeamRoomToken("restricted-team-ticket", 3L));
    }

    @Test
    void cameraLockedStudentReceivesTeamTicketWithoutCameraPublishSource() {
        AuthUser authUser = new AuthUser(7L, Role.STUDENT, "Student Kim");
        LiveSession session = session(10L, 2L);
        ClassroomMember member = org.mockito.Mockito.mock(ClassroomMember.class);
        Team team = team(3L);

        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(member));
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.isMember("session:10:kicked", "7")).thenReturn(false);
        when(setOperations.isMember("session:10:media:muted-mic", "7")).thenReturn(false);
        when(setOperations.isMember("session:10:media:disabled-cam", "7")).thenReturn(true);
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(team));
        when(liveKitTokenService.issueRoomTicket(
                "session-10", "student-7", "Student Kim", false))
                .thenReturn("classroom-ticket");
        when(liveKitTokenService.issueRoomTicket(
                "session-10-team-3", "student-7", "Student Kim", true,
                LiveKitTokenService.PUBLISH_SOURCES_WITHOUT_CAMERA))
                .thenReturn("camera-restricted-ticket");

        JoinResponse response = service.join(10L, authUser);

        assertThat(response.teamRoom())
                .isEqualTo(new TeamRoomToken("camera-restricted-ticket", 3L));
    }

    @Test
    void microphoneAndCameraLockedStudentKeepsScreenShareTicket() {
        AuthUser authUser = new AuthUser(7L, Role.STUDENT, "Student Kim");
        LiveSession session = session(10L, 2L);
        ClassroomMember member = org.mockito.Mockito.mock(ClassroomMember.class);
        Team team = team(3L);

        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(member));
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.isMember("session:10:kicked", "7")).thenReturn(false);
        when(setOperations.isMember("session:10:media:muted-mic", "7")).thenReturn(true);
        when(setOperations.isMember("session:10:media:disabled-cam", "7")).thenReturn(true);
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(2L, 7L))
                .thenReturn(Optional.of(team));
        when(liveKitTokenService.issueRoomTicket(
                "session-10", "student-7", "Student Kim", false))
                .thenReturn("classroom-ticket");
        when(liveKitTokenService.issueRoomTicket(
                "session-10-team-3", "student-7", "Student Kim", true,
                LiveKitTokenService.PUBLISH_SOURCES_WITHOUT_MICROPHONE_AND_CAMERA))
                .thenReturn("screen-share-only-ticket");

        JoinResponse response = service.join(10L, authUser);

        assertThat(response.teamRoom())
                .isEqualTo(new TeamRoomToken("screen-share-only-ticket", 3L));
    }

    @Test
    void managerVisitReturnsRequestedTeamTicket() {
        AuthUser authUser = new AuthUser(5L, Role.TEACHER, "Teacher Lee");
        LiveSession session = session(10L, 2L);
        startedBy(session, 5L);
        ClassroomMember member = member(ClassroomRole.OWNER);
        Team team = team(3L);

        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 5L))
                .thenReturn(Optional.of(member));
        when(teamRepository.findByIdAndClassroomId(3L, 2L)).thenReturn(Optional.of(team));
        when(liveKitTokenService.issueRoomTicket(
                "session-10-team-3", "teacher-5", "Teacher Lee", true))
                .thenReturn("visit-ticket");

        TeamRoomToken response = service.visit(10L, 3L, authUser);

        assertThat(response).isEqualTo(new TeamRoomToken("visit-ticket", 3L));
    }

    @Test
    void teacherWhoDidNotStartSessionCannotJoinRtcRoom() {
        AuthUser authUser = new AuthUser(6L, Role.TEACHER, "Another Teacher");
        LiveSession session = session(10L, 2L);
        startedBy(session, 5L);
        ClassroomMember member = org.mockito.Mockito.mock(ClassroomMember.class);

        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 6L))
                .thenReturn(Optional.of(member));
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.isMember("session:10:kicked", "6")).thenReturn(false);

        assertThatThrownBy(() -> service.join(10L, authUser))
                .isInstanceOf(com.mallang.global.error.ApiException.class)
                .hasMessageContaining("started this session");
    }

    @Test
    void teacherWhoDidNotStartSessionCannotVisitTeamRoom() {
        AuthUser authUser = new AuthUser(6L, Role.TEACHER, "Another Teacher");
        LiveSession session = session(10L, 2L);
        startedBy(session, 5L);
        ClassroomMember member = member(ClassroomRole.MAINTAINER);

        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 6L))
                .thenReturn(Optional.of(member));

        assertThatThrownBy(() -> service.visit(10L, 3L, authUser))
                .isInstanceOf(com.mallang.global.error.ApiException.class)
                .hasMessageContaining("started this session");
    }

    private LiveSession session(Long sessionId, Long classroomId) {
        LiveSession session = org.mockito.Mockito.mock(LiveSession.class);
        Classroom classroom = org.mockito.Mockito.mock(Classroom.class);
        when(session.getClassroom()).thenReturn(classroom);
        when(classroom.getId()).thenReturn(classroomId);
        return session;
    }

    private ClassroomMember member(ClassroomRole role) {
        ClassroomMember member = org.mockito.Mockito.mock(ClassroomMember.class);
        when(member.getRole()).thenReturn(role);
        return member;
    }

    private Team team(Long id) {
        Team team = org.mockito.Mockito.mock(Team.class);
        when(team.getId()).thenReturn(id);
        return team;
    }

    private void startedBy(LiveSession session, Long teacherId) {
        User teacher = org.mockito.Mockito.mock(User.class);
        when(session.getStartedBy()).thenReturn(teacher);
        when(teacher.getId()).thenReturn(teacherId);
    }
}
