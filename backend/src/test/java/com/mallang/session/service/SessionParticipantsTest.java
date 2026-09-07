package com.mallang.session.service;

import com.mallang.chat.service.ChatRouterService;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.SessionStartNotifier;
import com.mallang.session.dto.SessionDtos.SessionParticipantResponse;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.team.repository.TeamMemberRepository.UserTeamView;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 참가자 명단 조회 — S15P11A407-107 */
@ExtendWith(MockitoExtension.class)
class SessionParticipantsTest {

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock SessionParticipantRepository sessionParticipantRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock UserRepository userRepository;
    @Mock ChatRouterService chatRouterService;
    @Mock SessionStartNotifier sessionStartNotifier;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock StringRedisTemplate redis;
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
    void listsEveryClassroomMemberWithRoleAndTeam() {
        LiveSession session = session();
        ClassroomMember myMembership = member(ClassroomRole.OWNER, null);
        ClassroomMember teacher = member(ClassroomRole.OWNER, person(1L, "이선생", Role.TEACHER));
        ClassroomMember studentA = member(ClassroomRole.STUDENT, person(11L, "학생A", Role.STUDENT));
        ClassroomMember studentB = member(ClassroomRole.STUDENT, person(12L, "학생B", Role.STUDENT));
        List<UserTeamView> teams = List.of(userTeam(11L, 3L), userTeam(12L, 3L));

        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 1L))
                .thenReturn(Optional.of(myMembership));
        when(teamMemberRepository.findUserTeamsByClassroomId(2L)).thenReturn(teams);
        when(classroomMemberRepository.findWithUserByClassroomId(2L))
                .thenReturn(List.of(teacher, studentA, studentB));

        List<SessionParticipantResponse> participants = service.participants(10L, authUser(1L));

        assertThat(participants).containsExactly(
                new SessionParticipantResponse(1L, "이선생", "TEACHER", null),
                new SessionParticipantResponse(11L, "학생A", "STUDENT", 3L),
                new SessionParticipantResponse(12L, "학생B", "STUDENT", 3L));
    }

    @Test
    void studentWithoutTeamHasNullTeamId() {
        LiveSession session = session();
        ClassroomMember myMembership = member(ClassroomRole.STUDENT, null);
        ClassroomMember studentA = member(ClassroomRole.STUDENT, person(11L, "학생A", Role.STUDENT));

        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 11L))
                .thenReturn(Optional.of(myMembership));
        when(teamMemberRepository.findUserTeamsByClassroomId(2L)).thenReturn(List.of());
        when(classroomMemberRepository.findWithUserByClassroomId(2L)).thenReturn(List.of(studentA));

        List<SessionParticipantResponse> participants = service.participants(10L, student(11L));

        assertThat(participants).containsExactly(
                new SessionParticipantResponse(11L, "학생A", "STUDENT", null));
    }

    @Test
    void rejectsNonMember() {
        LiveSession session = session();
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 99L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.participants(10L, authUser(99L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원");
    }

    @Test
    void rejectsEndedSession() {
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.participants(10L, authUser(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("진행 중인 수업");
    }

    @Test
    void anotherTeacherCannotReadLiveState() {
        LiveSession session = session();
        ClassroomMember membership = member(ClassroomRole.MAINTAINER, null);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 2L))
                .thenReturn(Optional.of(membership));

        assertThatThrownBy(() -> service.state(10L, authUser(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    @Test
    void anotherTeacherCannotListLiveParticipants() {
        LiveSession session = session();
        ClassroomMember membership = member(ClassroomRole.MAINTAINER, null);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 2L))
                .thenReturn(Optional.of(membership));

        assertThatThrownBy(() -> service.participants(10L, authUser(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    @Test
    void anotherTeacherCannotEndLiveSession() {
        LiveSession session = session();
        ClassroomMember membership = member(ClassroomRole.MAINTAINER, null);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 2L))
                .thenReturn(Optional.of(membership));

        assertThatThrownBy(() -> service.end(10L, authUser(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser authUser(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private AuthUser student(Long id) {
        return new AuthUser(id, Role.STUDENT, "학생");
    }

    private LiveSession session() {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(2L);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        User starter = mock(User.class);
        lenient().when(starter.getId()).thenReturn(1L);
        lenient().when(session.getStartedBy()).thenReturn(starter);
        return session;
    }

    private User person(Long id, String name, Role role) {
        User user = mock(User.class);
        lenient().when(user.getId()).thenReturn(id);
        lenient().when(user.getName()).thenReturn(name);
        lenient().when(user.getRole()).thenReturn(role);
        return user;
    }

    private ClassroomMember member(ClassroomRole role, User user) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        lenient().when(member.getUser()).thenReturn(user);
        return member;
    }

    private UserTeamView userTeam(Long userId, Long teamId) {
        UserTeamView view = mock(UserTeamView.class);
        lenient().when(view.getUserId()).thenReturn(userId);
        lenient().when(view.getTeamId()).thenReturn(teamId);
        return view;
    }
}
