package com.mallang.session.service;

import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.SessionDtos.JoinResponse;
import com.mallang.session.dto.SessionDtos.RoomToken;
import com.mallang.session.dto.SessionDtos.TeamRoomToken;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.entity.Team;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.team.repository.TeamRepository;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class SessionTicketService {

    private final LiveSessionRepository liveSessionRepository;
    private final ClassroomMemberRepository classroomMemberRepository;
    private final TeamRepository teamRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final LiveKitTokenService liveKitTokenService;
    private final UserRepository userRepository;
    private final StringRedisTemplate redis;
    private final SessionTopicService sessionTopicService;

    @Value("${livekit.public-url}")
    private String liveKitPublicUrl;

    @Transactional(readOnly = true)
    public JoinResponse join(Long sessionId, AuthUser authUser) {
        LiveSession session = requireOpenSession(sessionId);
        Long classroomId = session.getClassroom().getId();
        requireMember(classroomId, authUser.id());
        requireNotKicked(sessionId, authUser.id());

        boolean teacher = authUser.isTeacher();
        if (teacher) {
            requireSessionTeacher(session, authUser.id());
        }
        String identity = identity(teacher, authUser.id());
        String displayName = displayName(authUser);

        String classroomTicket = liveKitTokenService.issueRoomTicket(
                classroomRoomName(sessionId), identity, displayName, teacher);

        TeamRoomToken teamRoom = null;
        if (!teacher) {
            boolean microphoneLocked = isMicrophoneLocked(sessionId, authUser.id());
            boolean cameraLocked = isCameraLocked(sessionId, authUser.id());
            teamRoom = teamMemberRepository
                    .findTeamByClassroomIdAndUserId(classroomId, authUser.id())
                    .map(team -> new TeamRoomToken(
                            liveKitTokenService.issueRoomTicket(
                                    teamRoomName(sessionId, team.getId()),
                                    identity,
                                    displayName,
                                    true,
                                    LiveKitTokenService.allowedPublishSources(
                                            microphoneLocked, cameraLocked)),
                            team.getId()))
                    .orElse(null);
        }

        return new JoinResponse(liveKitPublicUrl, new RoomToken(classroomTicket), teamRoom,
                sessionTopicService.getTopics(sessionId));
    }

    @Transactional(readOnly = true)
    public TeamRoomToken visit(Long sessionId, Long teamId, AuthUser authUser) {
        LiveSession session = requireOpenSession(sessionId);
        Long classroomId = session.getClassroom().getId();
        ClassroomMember member = requireMember(classroomId, authUser.id());
        if (!(authUser.isTeacher() && member.getRole().canManage())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-a-manager",
                    "Only a classroom owner or maintainer can visit a team room.");
        }
        requireSessionTeacher(session, authUser.id());

        Team team = teamRepository.findByIdAndClassroomId(teamId, classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "team-not-found",
                        "The team does not belong to this classroom."));
        String ticket = liveKitTokenService.issueRoomTicket(
                teamRoomName(sessionId, team.getId()),
                identity(true, authUser.id()),
                displayName(authUser),
                true);
        return new TeamRoomToken(ticket, team.getId());
    }

    private LiveSession requireOpenSession(Long sessionId) {
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-found",
                        "Session not found."));
        if (session.getEndedAt() != null) {
            throw new ApiException(HttpStatus.FORBIDDEN, "session-closed",
                    "The session has already ended.");
        }
        return session;
    }

    /** 하나의 RTC 수업에는 해당 수업을 시작한 선생님 한 명만 교사용 티켓을 받을 수 있다. */
    private void requireSessionTeacher(LiveSession session, Long userId) {
        if (session.getStartedBy() == null
                || !session.getStartedBy().getId().equals(userId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-session-teacher",
                    "Only the teacher who started this session can join as a teacher.");
        }
    }

    private ClassroomMember requireMember(Long classroomId, Long userId) {
        return classroomMemberRepository.findByClassroomIdAndUserId(classroomId, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "You are not a member of this classroom."));
    }

    private void requireNotKicked(Long sessionId, Long userId) {
        Boolean kicked = redis.opsForSet()
                .isMember(SessionRedisKeys.kicked(sessionId), String.valueOf(userId));
        if (Boolean.TRUE.equals(kicked)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "kicked-from-session",
                    "You were removed from this session.");
        }
    }

    private boolean isMicrophoneLocked(Long sessionId, Long userId) {
        Boolean locked = redis.opsForSet()
                .isMember(SessionRedisKeys.mutedMic(sessionId), String.valueOf(userId));
        return Boolean.TRUE.equals(locked);
    }

    private boolean isCameraLocked(Long sessionId, Long userId) {
        Boolean locked = redis.opsForSet()
                .isMember(SessionRedisKeys.disabledCam(sessionId), String.valueOf(userId));
        return Boolean.TRUE.equals(locked);
    }

    /** name 클레임 도입 전에 발급된 access 토큰에는 이름이 없다 — DB에서 보충 */
    private String displayName(AuthUser authUser) {
        if (authUser.displayName() != null) {
            return authUser.displayName();
        }
        return userRepository.findById(authUser.id()).map(User::getName).orElse(null);
    }

    static String classroomRoomName(Long sessionId) {
        return "session-" + sessionId;
    }

    static String teamRoomName(Long sessionId, Long teamId) {
        return "session-" + sessionId + "-team-" + teamId;
    }

    static String identity(boolean teacher, Long userId) {
        return (teacher ? "teacher-" : "student-") + userId;
    }
}
