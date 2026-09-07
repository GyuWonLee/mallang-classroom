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
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MediaControlServiceTest {

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
    private MediaControlTargetResolver targetResolver;

    @BeforeEach
    void setUp() {
        targetResolver = new MediaControlTargetResolver(
                liveSessionRepository, classroomMemberRepository,
                teamMemberRepository, teamRepository);
        service = new MediaControlService(
                targetResolver, liveKitRoomService, messagingTemplate, redis);
        lenient().when(redis.opsForSet()).thenReturn(setOperations);
        lenient().when(setOperations.isMember(anyString(), anyString())).thenReturn(false);
    }

    @Test
    void sessionTeacherLocksStudentMicrophoneInStudentsTeamRoom() {
        openSessionStartedBy(1L);
        assignedStudent(11L, 3L);

        service.control(10L, participant(MediaAction.MUTE_MIC, 11L), teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", true, false, MediaAction.MUTE_MIC);
        verify(setOperations).add(MUTED_KEY, "11");
    }

    @Test
    void successfulControlPublishesMediaControlEventWithChangedStudents() {
        openSessionStartedBy(1L);
        assignedStudent(11L, 3L);
        MediaControlRequest request = participant(MediaAction.DISABLE_CAM, 11L);

        service.control(10L, request, teacher(1L));

        ArgumentCaptor<Object> eventCaptor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSend(
                org.mockito.ArgumentMatchers.eq("/sub/sessions/10"),
                eventCaptor.capture());
        StompEnvelope envelope = (StompEnvelope) eventCaptor.getValue();
        assertThat(envelope.type()).isEqualTo(StompEventType.MEDIA_CONTROL);
        assertThat(envelope.payload()).isInstanceOf(Map.class);
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.payload();
        assertThat(payload)
                .containsEntry("target", MediaTarget.PARTICIPANT.name())
                .containsEntry("action", MediaAction.DISABLE_CAM.name())
                .containsEntry("userIds", List.of(11L));
    }

    @Test
    void sessionTeacherUnlocksStudentMicrophoneAndRemovesRedisState() {
        openSessionStartedBy(1L);
        assignedStudent(11L, 3L);

        service.control(10L, participant(MediaAction.UNLOCK_MIC, 11L), teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", false, false, MediaAction.UNLOCK_MIC);
        verify(setOperations).remove(MUTED_KEY, "11");
    }

    @Test
    void sessionTeacherLocksStudentCameraInStudentsTeamRoom() {
        openSessionStartedBy(1L);
        assignedStudent(11L, 3L);

        service.control(10L, participant(MediaAction.DISABLE_CAM, 11L), teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", false, true, MediaAction.DISABLE_CAM);
        verify(setOperations).add(CAMERA_KEY, "11");
    }

    @Test
    void sessionTeacherUnlocksStudentCameraAndRemovesRedisState() {
        openSessionStartedBy(1L);
        assignedStudent(11L, 3L);

        service.control(10L, participant(MediaAction.UNLOCK_CAM, 11L), teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", false, false, MediaAction.UNLOCK_CAM);
        verify(setOperations).remove(CAMERA_KEY, "11");
    }

    @Test
    void unlockingMicrophoneKeepsExistingCameraLock() {
        openSessionStartedBy(1L);
        assignedStudent(11L, 3L);
        when(setOperations.isMember(CAMERA_KEY, "11")).thenReturn(true);

        service.control(10L, participant(MediaAction.UNLOCK_MIC, 11L), teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", false, true, MediaAction.UNLOCK_MIC);
    }

    @Test
    void unlockingCameraKeepsExistingMicrophoneLock() {
        openSessionStartedBy(1L);
        assignedStudent(11L, 3L);
        when(setOperations.isMember(MUTED_KEY, "11")).thenReturn(true);

        service.control(10L, participant(MediaAction.UNLOCK_CAM, 11L), teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", true, false, MediaAction.UNLOCK_CAM);
    }

    @Test
    void lockedStudentRejoiningTeamRoomHasAllMediaLocksReapplied() {
        when(setOperations.isMember(MUTED_KEY, "11")).thenReturn(true);
        when(setOperations.isMember(CAMERA_KEY, "11")).thenReturn(true);

        service.reapplyMediaLocksOnJoin(10L, "session-10-team-3", 11L);

        verify(liveKitRoomService).applyMediaLocks(
                "session-10-team-3", "student-11", true, true);
    }

    @Test
    void unlockedStudentRejoiningTeamRoomIsNotRestricted() {
        when(setOperations.isMember(MUTED_KEY, "11")).thenReturn(false);
        when(setOperations.isMember(CAMERA_KEY, "11")).thenReturn(false);

        service.reapplyMediaLocksOnJoin(10L, "session-10-team-3", 11L);

        verify(liveKitRoomService, never()).applyMediaLocks(
                anyString(), anyString(), org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void liveKitLockFailureDoesNotWriteRedisLockState() {
        openSessionStartedBy(1L);
        assignedStudent(11L, 3L);
        doThrow(new ApiException(HttpStatus.BAD_GATEWAY, "livekit-api-failed",
                "LiveKit 미디어 권한 변경에 실패했습니다."))
                .when(liveKitRoomService)
                .applyMediaControl("session-10-team-3", "student-11",
                        true, false, MediaAction.MUTE_MIC);

        assertThatThrownBy(() -> service.control(
                10L, participant(MediaAction.MUTE_MIC, 11L), teacher(1L)))
                .isInstanceOf(ApiException.class);

        verify(setOperations, never()).add(MUTED_KEY, "11");
    }

    @Test
    void anotherTeacherCannotControlSessionMedia() {
        openSessionStartedBy(1L);

        assertThatThrownBy(() -> service.control(
                10L, participant(MediaAction.MUTE_MIC, 11L), teacher(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");

        verify(liveKitRoomService, never()).applyMediaControl(
                anyString(), anyString(), org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.any(MediaAction.class));
    }

    @Test
    void studentCannotControlSessionMediaEvenWithSameUserId() {
        openSessionStartedBy(1L);
        AuthUser student = new AuthUser(1L, Role.STUDENT, "학생");

        assertThatThrownBy(() -> service.control(
                10L, participant(MediaAction.MUTE_MIC, 11L), student))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    @Test
    void participantControlRequiresUserId() {
        openSessionStartedBy(1L);

        assertThatThrownBy(() -> service.control(
                10L, participant(MediaAction.MUTE_MIC, null), teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("userId");
    }

    @Test
    void teamTargetLocksEveryStudentCameraInTheTeam() {
        openSessionStartedBy(1L);
        Team team = mock(Team.class);
        when(teamRepository.findByIdAndClassroomId(3L, 2L))
                .thenReturn(Optional.of(team));
        when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(
                2L, List.of(ClassroomRole.STUDENT)))
                .thenReturn(List.of(11L, 12L));
        when(teamMemberRepository.findUserIdsByTeamId(3L))
                .thenReturn(List.of(11L, 12L));
        MediaControlRequest request = new MediaControlRequest(
                MediaTarget.TEAM, MediaAction.DISABLE_CAM, 3L, null);

        service.control(10L, request, teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", false, true, MediaAction.DISABLE_CAM);
        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-12", false, true, MediaAction.DISABLE_CAM);
        verify(setOperations).add(CAMERA_KEY, "11");
        verify(setOperations).add(CAMERA_KEY, "12");
    }

    @Test
    void allTargetLocksEveryClassroomStudentsMicrophoneAcrossTeams() {
        openSessionStartedBy(1L);
        when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(
                2L, List.of(ClassroomRole.STUDENT)))
                .thenReturn(List.of(12L, 11L));
        UserTeamView student11Team = userTeam(11L, 3L);
        UserTeamView student12Team = userTeam(12L, 4L);
        when(teamMemberRepository.findUserTeamsByClassroomId(2L))
                .thenReturn(List.of(student11Team, student12Team));
        MediaControlRequest request = new MediaControlRequest(
                MediaTarget.ALL, MediaAction.MUTE_MIC, null, null);

        service.control(10L, request, teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", true, false, MediaAction.MUTE_MIC);
        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-4", "student-12", true, false, MediaAction.MUTE_MIC);
        verify(setOperations).add(MUTED_KEY, "11");
        verify(setOperations).add(MUTED_KEY, "12");
    }

    @Test
    void partialBulkFailurePublishesOnlyStudentsChangedBeforeFailure() {
        openSessionStartedBy(1L);
        when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(
                2L, List.of(ClassroomRole.STUDENT)))
                .thenReturn(List.of(11L, 12L));
        UserTeamView student11Team = userTeam(11L, 3L);
        UserTeamView student12Team = userTeam(12L, 4L);
        when(teamMemberRepository.findUserTeamsByClassroomId(2L))
                .thenReturn(List.of(student11Team, student12Team));
        MediaControlRequest request = new MediaControlRequest(
                MediaTarget.ALL, MediaAction.MUTE_MIC, null, null);
        lenient().doThrow(new ApiException(HttpStatus.BAD_GATEWAY, "livekit-api-failed",
                "LiveKit 미디어 권한 변경에 실패했습니다."))
                .when(liveKitRoomService)
                .applyMediaControl("session-10-team-4", "student-12",
                        true, false, MediaAction.MUTE_MIC);

        assertThatThrownBy(() -> service.control(10L, request, teacher(1L)))
                .isInstanceOf(ApiException.class);

        verify(setOperations).add(MUTED_KEY, "11");
        verify(setOperations, never()).add(MUTED_KEY, "12");
        ArgumentCaptor<Object> eventCaptor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSend(
                org.mockito.ArgumentMatchers.eq("/sub/sessions/10"),
                eventCaptor.capture());
        StompEnvelope envelope = (StompEnvelope) eventCaptor.getValue();
        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.payload();
        assertThat(payload)
                .containsEntry("target", MediaTarget.ALL.name())
                .containsEntry("action", MediaAction.MUTE_MIC.name())
                .containsEntry("userIds", List.of(11L));
    }

    @Test
    void teamTargetRequiresTeamId() {
        openSessionStartedBy(1L);
        MediaControlRequest request = new MediaControlRequest(
                MediaTarget.TEAM, MediaAction.MUTE_MIC, null, null);

        assertThatThrownBy(() -> service.control(10L, request, teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("teamId");
    }

    @Test
    void teamTargetMustBelongToTheCurrentClassroom() {
        openSessionStartedBy(1L);
        when(teamRepository.findByIdAndClassroomId(3L, 2L))
                .thenReturn(Optional.empty());
        MediaControlRequest request = new MediaControlRequest(
                MediaTarget.TEAM, MediaAction.MUTE_MIC, 3L, null);

        assertThatThrownBy(() -> service.control(10L, request, teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이 학급");
    }

    @Test
    void allTargetControlsAssignedStudentsAndSkipsStudentsWithoutTeam() {
        openSessionStartedBy(1L);
        when(classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(
                2L, List.of(ClassroomRole.STUDENT)))
                .thenReturn(List.of(11L, 12L));
        UserTeamView student11Team = userTeam(11L, 3L);
        when(teamMemberRepository.findUserTeamsByClassroomId(2L))
                .thenReturn(List.of(student11Team));
        MediaControlRequest request = new MediaControlRequest(
                MediaTarget.ALL, MediaAction.DISABLE_CAM, null, null);

        service.control(10L, request, teacher(1L));

        verify(liveKitRoomService).applyMediaControl(
                "session-10-team-3", "student-11", false, true, MediaAction.DISABLE_CAM);
        verify(setOperations).add(CAMERA_KEY, "11");
        verify(liveKitRoomService, never()).applyMediaControl(
                anyString(), org.mockito.ArgumentMatchers.eq("student-12"),
                org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.any(MediaAction.class));
    }

    @Test
    void requestActionsAreNoLongerRejectedAsUnsupported() {
        openSessionStartedBy(1L);
        MediaControlRequest request = new MediaControlRequest(
                MediaTarget.ALL, MediaAction.REQUEST_ENABLE_CAM, null, null);

        // 예전엔 501 이었다. 이제는 강제가 아니라 학생 화면에 띄우는 알림으로 처리한다
        // (동작 자체는 MediaRequestTest 가 검증한다). 여기서는 더 이상 막지 않는다는 것만 고정한다.
        org.assertj.core.api.Assertions
                .assertThatCode(() -> service.control(10L, request, teacher(1L)))
                .doesNotThrowAnyException();
    }

    @Test
    void targetMustBeAStudentInTheSameClassroom() {
        openSessionStartedBy(1L);
        ClassroomMember maintainer = member(ClassroomRole.MAINTAINER);
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 11L))
                .thenReturn(Optional.of(maintainer));

        assertThatThrownBy(() -> service.control(
                10L, participant(MediaAction.MUTE_MIC, 11L), teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학생 계정");
    }

    @Test
    void studentWithoutTeamCannotBeControlled() {
        openSessionStartedBy(1L);
        ClassroomMember student = member(ClassroomRole.STUDENT);
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 11L))
                .thenReturn(Optional.of(student));
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(2L, 11L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.control(
                10L, participant(MediaAction.MUTE_MIC, 11L), teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("팀에 배정");
    }

    @Test
    void closedSessionCannotControlMedia() {
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.control(
                10L, participant(MediaAction.MUTE_MIC, 11L), teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("진행 중인 수업");
    }

    private MediaControlRequest participant(MediaAction action, Long userId) {
        return new MediaControlRequest(MediaTarget.PARTICIPANT, action, null, userId);
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private ClassroomMember member(ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        when(member.getRole()).thenReturn(role);
        return member;
    }

    private UserTeamView userTeam(Long userId, Long teamId) {
        UserTeamView view = mock(UserTeamView.class);
        when(view.getUserId()).thenReturn(userId);
        when(view.getTeamId()).thenReturn(teamId);
        return view;
    }

    private void assignedStudent(Long studentId, Long teamId) {
        ClassroomMember student = member(ClassroomRole.STUDENT);
        Team team = mock(Team.class);
        when(team.getId()).thenReturn(teamId);
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, studentId))
                .thenReturn(Optional.of(student));
        when(teamMemberRepository.findTeamByClassroomIdAndUserId(2L, studentId))
                .thenReturn(Optional.of(team));
    }

    private void openSessionStartedBy(Long teacherId) {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        User teacher = mock(User.class);
        when(classroom.getId()).thenReturn(2L);
        lenient().when(teacher.getId()).thenReturn(teacherId);
        when(session.getClassroom()).thenReturn(classroom);
        lenient().when(session.getStartedBy()).thenReturn(teacher);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L))
                .thenReturn(Optional.of(session));
    }
}
