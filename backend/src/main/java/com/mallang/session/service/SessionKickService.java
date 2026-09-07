package com.mallang.session.service;

import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.team.repository.TeamMemberRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 수업 중 강퇴 (명세 §5 재입장 차단).
 *
 * <p>차단 자체는 이전부터 {@link SessionTicketService} 가 Redis 명단을 보고 막게 돼 있었는데,
 * 그 명단에 넣는 쪽이 없어 한 번도 발동하지 않았다. 여기가 그 빠진 입구다.</p>
 *
 * <p>트랜잭션을 따로 열지 않는다. 검증에 필요한 조회는 리포지토리 자체 트랜잭션으로 충분하고,
 * 그 뒤로는 Redis·LiveKit 외부 호출이라 커넥션을 쥐고 있을 이유가 없다
 * (MediaControlService 와 같은 방식).</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SessionKickService {

    private final SessionStarterGuard starterGuard;
    private final LiveSessionRepository liveSessionRepository;
    private final ClassroomMemberRepository classroomMemberRepository;
    private final SessionParticipantRepository sessionParticipantRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final LiveKitRoomService liveKitRoomService;
    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redis;

    public void kick(Long sessionId, Long targetUserId, AuthUser authUser) {
        starterGuard.requireStarter(sessionId, authUser);
        Long teamId = resolveTeam(sessionId, targetUserId, authUser);

        // 명단에 먼저 올린다. 끊는 것이 먼저면 그 틈에 학생이 기존 티켓으로 재입장할 수 있다.
        redis.opsForSet().add(SessionRedisKeys.kicked(sessionId), String.valueOf(targetUserId));

        String identity = SessionTicketService.identity(false, targetUserId);
        liveKitRoomService.removeParticipant(
                SessionTicketService.classroomRoomName(sessionId), identity);
        if (teamId != null) {
            liveKitRoomService.removeParticipant(
                    SessionTicketService.teamRoomName(sessionId, teamId), identity);
        }

        // 웹훅 leave 가 오지 않을 수 있다 — 서버가 끊으면 클라가 정상 종료 신호를 못 보낸다.
        sessionParticipantRepository.markLeft(sessionId, targetUserId, LocalDateTime.now());

        messagingTemplate.convertAndSend("/sub/sessions/" + sessionId,
                StompEnvelope.of(StompEventType.KICKED, Map.of(
                        "userId", targetUserId,
                        "by", authUser.id())));
    }

    /**
     * 강퇴 대상을 검증하고 팀룸 위치를 알아낸다 (팀이 없으면 null).
     *
     * <p>선생님을 내보낼 수 없게 막는 이유: 수업을 함께 보는 선생님끼리 서로 내보내기 시작하면
     * 그건 수업 운영이 아니라 사고다. 담당자 문제는 학급 권한(구성원 제외)으로 푼다.</p>
     */
    private Long resolveTeam(Long sessionId, Long targetUserId, AuthUser authUser) {
        if (targetUserId.equals(authUser.id())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "cannot-kick-self",
                    "자기 자신을 내보낼 수 없습니다.");
        }
        LiveSession session = liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-open",
                        "진행 중인 수업이 아닙니다."));
        // 식별자 getter 는 LAZY 프록시를 초기화하지 않는다 — 학급 행을 더 읽지 않는다.
        Long classroomId = session.getClassroom().getId();

        ClassroomMember member = classroomMemberRepository
                .findByClassroomIdAndUserId(classroomId, targetUserId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not-a-member",
                        "이 학급 구성원이 아닙니다."));
        if (member.getRole().canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "cannot-kick-teacher",
                    "선생님은 수업에서 내보낼 수 없습니다.");
        }

        return teamMemberRepository.findTeamByClassroomIdAndUserId(classroomId, targetUserId)
                .map(team -> team.getId())
                .orElse(null);
    }
}
