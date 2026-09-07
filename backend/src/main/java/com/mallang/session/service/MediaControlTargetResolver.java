package com.mallang.session.service;

import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.SessionDtos.MediaAction;
import com.mallang.session.dto.SessionDtos.MediaControlRequest;
import com.mallang.session.dto.SessionDtos.MediaTarget;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.entity.Team;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.team.repository.TeamRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 미디어 제어에 필요한 DB 조회·권한 검증을 짧은 읽기 트랜잭션 안에서 끝낸다. */
@Service
@RequiredArgsConstructor
public class MediaControlTargetResolver {

    private final LiveSessionRepository liveSessionRepository;
    private final ClassroomMemberRepository classroomMemberRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final TeamRepository teamRepository;

    @Transactional(readOnly = true)
    public List<ResolvedMediaControl> resolve(Long sessionId, MediaControlRequest request,
                                              AuthUser authUser) {
        LiveSession session = liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-open",
                        "진행 중인 수업이 아닙니다."));
        Long classroomId = session.getClassroom().getId();
        requireSessionTeacher(session, authUser);
        requireSupportedAction(request.action());

        return switch (request.target()) {
            case PARTICIPANT -> resolveParticipant(sessionId, classroomId, request.userId());
            case TEAM -> resolveTeam(sessionId, classroomId, request.teamId());
            case ALL -> resolveAll(sessionId, classroomId);
        };
    }

    private List<ResolvedMediaControl> resolveParticipant(Long sessionId, Long classroomId,
                                                           Long requestedUserId) {
        Long studentId = requireUserId(requestedUserId);
        ClassroomMember target = classroomMemberRepository
                .findByClassroomIdAndUserId(classroomId, studentId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not-a-member",
                        "해당 학생은 이 학급의 구성원이 아닙니다."));
        if (target.getRole() != ClassroomRole.STUDENT) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "target-not-student",
                    "학생 계정만 미디어 제어 대상으로 지정할 수 있습니다.");
        }

        Team team = teamMemberRepository
                .findTeamByClassroomIdAndUserId(classroomId, studentId)
                .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT,
                        "student-team-not-assigned", "학생이 팀에 배정되어 있지 않습니다."));

        return List.of(new ResolvedMediaControl(
                sessionId,
                studentId,
                SessionTicketService.teamRoomName(sessionId, team.getId()),
                SessionTicketService.identity(false, studentId)));
    }

    private List<ResolvedMediaControl> resolveTeam(Long sessionId, Long classroomId,
                                                   Long requestedTeamId) {
        Long teamId = requireTeamId(requestedTeamId);
        teamRepository.findByIdAndClassroomId(teamId, classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "team-not-found",
                        "해당 팀은 이 학급에 속하지 않습니다."));

        Set<Long> classroomStudentIds = new HashSet<>(classroomMemberRepository
                .findUserIdsByClassroomIdAndRoleIn(
                        classroomId, List.of(ClassroomRole.STUDENT)));
        List<Long> teamStudentIds = teamMemberRepository.findUserIdsByTeamId(teamId).stream()
                .filter(classroomStudentIds::contains)
                .sorted()
                .toList();

        return targetsInTeam(sessionId, teamId, teamStudentIds);
    }

    private List<ResolvedMediaControl> resolveAll(Long sessionId, Long classroomId) {
        List<Long> studentIds = classroomMemberRepository
                .findUserIdsByClassroomIdAndRoleIn(
                        classroomId, List.of(ClassroomRole.STUDENT))
                .stream()
                .sorted()
                .toList();
        Map<Long, Long> teamByStudentId = new HashMap<>();
        teamMemberRepository.findUserTeamsByClassroomId(classroomId)
                .forEach(view -> teamByStudentId.put(view.getUserId(), view.getTeamId()));

        List<ResolvedMediaControl> targets = new ArrayList<>();
        for (Long studentId : studentIds) {
            Long teamId = teamByStudentId.get(studentId);
            if (teamId == null) {
                // 팀 룸이 없는 학생은 LiveKit에서 제어할 대상이 아니므로 ALL에서 제외한다.
                continue;
            }
            targets.add(target(sessionId, teamId, studentId));
        }
        return targets;
    }

    private List<ResolvedMediaControl> targetsInTeam(Long sessionId, Long teamId,
                                                      List<Long> studentIds) {
        return studentIds.stream()
                .map(studentId -> target(sessionId, teamId, studentId))
                .toList();
    }

    private ResolvedMediaControl target(Long sessionId, Long teamId, Long studentId) {
        return new ResolvedMediaControl(
                sessionId,
                studentId,
                SessionTicketService.teamRoomName(sessionId, teamId),
                SessionTicketService.identity(false, studentId));
    }

    /**
     * 대상 해석은 동작과 무관하므로 여기서 동작을 거르지 않는다.
     * 켜기 요청(REQUEST_*)은 잠금/해제와 처리 경로가 달라 {@link MediaControlService} 가 나눈다.
     */
    private void requireSupportedAction(MediaAction action) {
        if (action == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "media-action-required",
                    "미디어 제어 동작이 필요합니다.");
        }
    }

    private Long requireUserId(Long userId) {
        if (userId == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "user-id-required",
                    "PARTICIPANT 대상에는 userId가 필요합니다.");
        }
        return userId;
    }

    private Long requireTeamId(Long teamId) {
        if (teamId == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "team-id-required",
                    "TEAM 대상에는 teamId가 필요합니다.");
        }
        return teamId;
    }

    private void requireSessionTeacher(LiveSession session, AuthUser authUser) {
        if (!authUser.isTeacher()
                || session.getStartedBy() == null
                || !session.getStartedBy().getId().equals(authUser.id())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-session-teacher",
                    "현재 RTC 수업을 시작한 선생님만 미디어를 제어할 수 있습니다.");
        }
    }

    public record ResolvedMediaControl(
            Long sessionId,
            Long studentId,
            String roomName,
            String identity) {
    }
}
