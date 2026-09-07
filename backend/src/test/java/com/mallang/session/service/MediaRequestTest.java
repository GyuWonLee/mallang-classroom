package com.mallang.session.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.dto.SessionDtos.MediaAction;
import com.mallang.session.dto.SessionDtos.MediaControlRequest;
import com.mallang.session.dto.SessionDtos.MediaTarget;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.entity.Team;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.team.repository.TeamMemberRepository.UserTeamView;
import com.mallang.team.repository.TeamRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 마이크·카메라 켜기 요청 — S15P11A407-137
 *
 * <p>강제 제어(MUTE_MIC 등)와 메커니즘이 다르다. 브라우저는 사용자 제스처 없이 마이크·카메라를
 * 켤 수 없어서 서버가 강제할 방법이 없다. 그래서 이 둘만 미구현(501)으로 남아 있었다.</p>
 *
 * <p>구현 방향은 "요청을 학생 화면에 띄우는 것" — LiveKit 권한도 Redis 잠금도 건드리지 않는다.
 * 그리고 선생님이 잠가 둔 학생에게 켜 달라고 하는 건 모순이므로 대상에서 걸러진다.</p>
 */
@ExtendWith(MockitoExtension.class)
class MediaRequestTest {

    private static final String MUTED_KEY = "session:10:media:muted-mic";
    private static final String CAMERA_KEY = "session:10:media:disabled-cam";

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock TeamRepository teamRepository;
    @Mock LiveKitRoomService liveKitRoomService;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock StringRedisTemplate redis;
    @Mock SetOperations<String, String> setOperations;

    private MediaControlService service;

    @BeforeEach
    void setUp() {
        MediaControlTargetResolver resolver = new MediaControlTargetResolver(
                liveSessionRepository, classroomMemberRepository,
                teamMemberRepository, teamRepository);
        service = new MediaControlService(resolver, liveKitRoomService, messagingTemplate, redis);
        lenient().when(redis.opsForSet()).thenReturn(setOperations);
    }

    @Test
    void requestUnmuteMicNotifiesTheStudentWithoutTouchingLiveKit() {
        openSession();
        studentInClassroom(11L);
        notLocked(MUTED_KEY, "11");

        service.control(10L, participant(MediaAction.REQUEST_UNMUTE_MIC, 11L), teacher());

        // 요청은 권한 변경이 아니다 — LiveKit 도 Redis 잠금도 건드리지 않는다
        verify(liveKitRoomService, never()).applyMediaControl(
                anyString(), anyString(), anyBoolean(), anyBoolean(), any());
        verify(setOperations, never()).add(anyString(), anyString());
        verify(setOperations, never()).remove(anyString(), any());

        StompEnvelope envelope = published();
        assertThat(envelope.type()).isEqualTo(StompEventType.MEDIA_REQUEST);
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.payload();
        assertThat(payload)
                .containsEntry("action", MediaAction.REQUEST_UNMUTE_MIC.name())
                .containsEntry("target", MediaTarget.PARTICIPANT.name())
                .containsEntry("userIds", List.of(11L));
    }

    @Test
    void requestEnableCameraLooksAtTheCameraLockNotTheMicLock() {
        openSession();
        studentInClassroom(11L);
        notLocked(CAMERA_KEY, "11");

        service.control(10L, participant(MediaAction.REQUEST_ENABLE_CAM, 11L), teacher());

        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) published().payload();
        assertThat(payload).containsEntry("action", MediaAction.REQUEST_ENABLE_CAM.name());
    }

    @Test
    void askingALockedStudentToUnmuteIs409() {
        openSession();
        studentInClassroom(11L);
        locked(MUTED_KEY, "11");

        // 선생님이 잠가 놓고 켜 달라는 건 모순이다 — 잠금 해제가 먼저다
        assertThatThrownBy(() ->
                service.control(10L, participant(MediaAction.REQUEST_UNMUTE_MIC, 11L), teacher()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("잠금");

        verify(messagingTemplate, never()).convertAndSend(anyString(), (Object) any());
    }

    @Test
    void bulkRequestSilentlySkipsLockedStudents() {
        openSession();
        teamAssignments(userTeam(11L, 7L), userTeam(12L, 7L));
        locked(MUTED_KEY, "11");
        notLocked(MUTED_KEY, "12");

        service.control(10L, new MediaControlRequest(
                MediaTarget.ALL, MediaAction.REQUEST_UNMUTE_MIC, null, null), teacher());

        // ALL 은 대상 밖 학생을 조용히 제외하는 것이 기존 규약이다(팀 미배정 처리와 같은 결)
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) published().payload();
        assertThat(payload).containsEntry("userIds", List.of(12L));
    }

    @Test
    void bulkRequestWithEveryoneLockedPublishesNothing() {
        openSession();
        teamAssignments(userTeam(11L, 7L));
        locked(MUTED_KEY, "11");

        service.control(10L, new MediaControlRequest(
                MediaTarget.ALL, MediaAction.REQUEST_UNMUTE_MIC, null, null), teacher());

        verify(messagingTemplate, never()).convertAndSend(anyString(), (Object) any());
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private StompEnvelope published() {
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSend(eq("/sub/sessions/10"), captor.capture());
        return (StompEnvelope) captor.getValue();
    }

    private MediaControlRequest participant(MediaAction action, Long userId) {
        return new MediaControlRequest(MediaTarget.PARTICIPANT, action, null, userId);
    }

    private void openSession() {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(2L);
        User starter = mock(User.class);
        lenient().when(starter.getId()).thenReturn(1L);
        LiveSession session = mock(LiveSession.class);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        lenient().when(session.getStartedBy()).thenReturn(starter);
        Optional<LiveSession> found = Optional.of(session);
        lenient().when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(found);
    }

    private void studentInClassroom(Long userId) {
        ClassroomMember student = mock(ClassroomMember.class);
        lenient().when(student.getRole()).thenReturn(ClassroomRole.STUDENT);
        Optional<ClassroomMember> found = Optional.of(student);
        lenient().when(classroomMemberRepository.findByClassroomIdAndUserId(2L, userId))
                .thenReturn(found);
        Team team = mock(Team.class);
        lenient().when(team.getId()).thenReturn(7L);
        Optional<Team> foundTeam = Optional.of(team);
        lenient().when(teamMemberRepository.findTeamByClassroomIdAndUserId(2L, userId))
                .thenReturn(foundTeam);
    }

    private void teamAssignments(UserTeamView... views) {
        List<UserTeamView> assignments = List.of(views);
        List<Long> studentIds = assignments.stream().map(UserTeamView::getUserId).sorted().toList();
        lenient().when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(
                eq(2L), any())).thenReturn(studentIds);
        lenient().when(teamMemberRepository.findUserTeamsByClassroomId(2L))
                .thenReturn(assignments);
    }

    private UserTeamView userTeam(Long userId, Long teamId) {
        UserTeamView view = mock(UserTeamView.class);
        lenient().when(view.getUserId()).thenReturn(userId);
        lenient().when(view.getTeamId()).thenReturn(teamId);
        return view;
    }

    private void locked(String key, String member) {
        lenient().when(setOperations.isMember(key, member)).thenReturn(true);
    }

    private void notLocked(String key, String member) {
        lenient().when(setOperations.isMember(key, member)).thenReturn(false);
    }

    private AuthUser teacher() {
        return new AuthUser(1L, Role.TEACHER, "김선생");
    }
}
