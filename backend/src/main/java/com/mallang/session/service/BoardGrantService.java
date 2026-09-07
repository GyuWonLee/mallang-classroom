package com.mallang.session.service;

import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.dto.SessionDtos.BoardAction;
import com.mallang.session.dto.SessionDtos.BoardGrantRequest;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.repository.TeamMemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * 판서 권한 부여/회수 (명세 §5). 권한 집합은 Redis SET — BoardController(획 발행)와
 * GET /state 가 같은 키를 읽으므로 반드시 SessionRedisKeys 를 통해 만든다.
 *
 * 선생님은 항상 판서 가능하므로 이 집합은 "학생 중 누가 가능한지"만 담는다.
 */
@Service
@RequiredArgsConstructor
public class BoardGrantService {

    private final LiveSessionRepository liveSessionRepository;
    private final ClassroomMemberRepository classroomMemberRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redis;

    @Transactional(readOnly = true)
    public void updateGrants(Long sessionId, BoardGrantRequest request, AuthUser authUser) {
        LiveSession session = liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-open",
                        "진행 중인 수업이 아닙니다"));
        Long classroomId = session.getClassroom().getId();
        requireSessionTeacher(session, authUser);
        requireManager(classroomId, authUser);

        List<Long> targets = resolveTargets(classroomId, request);
        String key = SessionRedisKeys.boardGrants(sessionId);
        String[] ids = targets.stream().map(String::valueOf).toArray(String[]::new);

        if (request.action() == BoardAction.GRANT) {
            if (ids.length > 0) {
                redis.opsForSet().add(key, ids);
            }
        } else if (ids.length > 0) {
            redis.opsForSet().remove(key, (Object[]) ids);
        }

        messagingTemplate.convertAndSend("/sub/sessions/" + sessionId,
                StompEnvelope.of(StompEventType.BOARD_GRANT, Map.of(
                        "target", request.target().name(),
                        "action", request.action().name(),
                        "userIds", targets)));
    }

    /** 대상 학생 id 목록 — 선생님은 항상 판서 가능하므로 집합에서 제외한다 */
    private List<Long> resolveTargets(Long classroomId, BoardGrantRequest request) {
        return switch (request.target()) {
            case ALL -> classroomMemberRepository
                    .findUserIdsByClassroomIdAndRoleIn(classroomId, List.of(ClassroomRole.STUDENT));
            case TEAM -> {
                Long teamId = require(request.teamId(), "team-id-required",
                        "TEAM 대상에는 teamId 가 필요합니다");
                yield teamMemberRepository.findUserIdsByTeamId(teamId);
            }
            case PARTICIPANT -> {
                Long userId = require(request.userId(), "user-id-required",
                        "PARTICIPANT 대상에는 userId 가 필요합니다");
                classroomMemberRepository.findByClassroomIdAndUserId(classroomId, userId)
                        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not-a-member",
                                "이 학급의 구성원이 아닙니다"));
                yield List.of(userId);
            }
        };
    }

    private Long require(Long value, String type, String message) {
        if (value == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, type, message);
        }
        return value;
    }

    private void requireManager(Long classroomId, AuthUser authUser) {
        ClassroomRole role = classroomMemberRepository
                .findByClassroomIdAndUserId(classroomId, authUser.id())
                .map(ClassroomMember::getRole)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "학급 구성원이 아닙니다"));
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-a-manager",
                    "판서 권한 관리는 OWNER/MAINTAINER 전용입니다");
        }
    }

    private void requireSessionTeacher(LiveSession session, AuthUser authUser) {
        if (!authUser.isTeacher()
                || session.getStartedBy() == null
                || !session.getStartedBy().getId().equals(authUser.id())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-session-teacher",
                    "현재 수업을 시작한 선생님만 판서 권한을 관리할 수 있습니다");
        }
    }
}
