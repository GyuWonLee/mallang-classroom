package com.mallang.session.controller;

import com.mallang.chat.service.ChatRouterService;
import com.mallang.global.error.ApiException;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.entity.SessionParticipant;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.session.service.LiveKitWebhookVerifier;
import com.mallang.session.service.MediaControlService;
import com.mallang.session.service.PresenceService;
import com.mallang.session.service.SessionService;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * LiveKit 웹훅 수신 — 프레즌스(Redis) 갱신 + 출석(session_participant) 기록.
 * 룸 이름 규칙: 메인 "session-{id}", 팀 "session-{id}-team-{teamId}"
 * identity 규칙: "teacher-{userId}" / "student-{userId}" ← LiveKit 토큰 발급 코드와 반드시 일치시킬 것
 * 선행 조건: infra/server/livekit/livekit.yaml 에 webhook.urls + api_key 설정 (미설정 시 전체 미동작)
 * 서명 검증: Authorization 헤더 JWT + 본문 해시 (LiveKitWebhookVerifier)
 */
@RestController
@RequestMapping("/api/webhooks/livekit")
@RequiredArgsConstructor
public class LiveKitWebhookController {

    private static final Pattern MAIN_ROOM = Pattern.compile("^session-(\\d+)$");
    private static final Pattern TEAM_ROOM = Pattern.compile("^session-(\\d+)-team-(\\d+)$");

    private final PresenceService presenceService;
    private final ChatRouterService chatRouterService;
    private final LiveSessionRepository liveSessionRepository;
    private final SessionParticipantRepository sessionParticipantRepository;
    private final UserRepository userRepository;
    private final LiveKitWebhookVerifier webhookVerifier;
    private final MediaControlService mediaControlService;
    private final SessionService sessionService;
    private final ObjectMapper objectMapper;

    @PostMapping
    @Transactional
    @SuppressWarnings("unchecked")
    public void handle(@RequestHeader(value = "Authorization", required = false) String authorization,
                       @RequestBody String rawBody) {
        // 서명 검증에 원문이 필요해 String으로 받고 직접 파싱한다
        webhookVerifier.verify(authorization, rawBody);
        Map<String, Object> event;
        try {
            event = objectMapper.readValue(rawBody, new TypeReference<Map<String, Object>>() {});
        } catch (JacksonException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-webhook-body",
                    "웹훅 본문을 해석할 수 없습니다");
        }
        String type = (String) event.get("event");
        Map<String, Object> room = (Map<String, Object>) event.get("room");
        if (type == null || room == null) {
            return;
        }
        String roomName = (String) room.get("name");
        if (roomName == null) {
            return;
        }

        // room_finished 에는 participant 가 없다 — 방이 닫힌 사건이지 특정 참가자의 사건이
        // 아니기 때문이다. 예전에는 아래 participant null 검사에 걸려 통째로 버려졌고,
        // 그래서 선생님이 "수업 종료"를 누르지 않으면 수업이 영원히 열린 채로 남았다.
        // 메인 룸이 닫혔다 = 모두 나가고 empty_timeout(기본 5분)이 지났다 → 수업 종료로 본다.
        // 팀 룸이 닫히는 것은 수업 종료가 아니므로 메인 룸만 처리한다.
        if ("room_finished".equals(type)) {
            Matcher finished = MAIN_ROOM.matcher(roomName);
            if (finished.matches()) {
                sessionService.endByRoomFinished(Long.valueOf(finished.group(1)));
            }
            return;
        }

        Map<String, Object> participant = (Map<String, Object>) event.get("participant");
        if (participant == null) {
            return;
        }
        String identity = (String) participant.get("identity");
        if (identity == null || !identity.contains("-")) {
            return;
        }

        boolean isTeacher = identity.startsWith("teacher-");
        Long userId = Long.valueOf(identity.substring(identity.indexOf('-') + 1));
        boolean joined = "participant_joined".equals(type);
        boolean left = "participant_left".equals(type);
        if (!joined && !left) {
            return;
        }

        Matcher main = MAIN_ROOM.matcher(roomName);
        if (main.matches()) {
            recordAttendance(Long.valueOf(main.group(1)), userId, joined);
            return;
        }
        Matcher team = TEAM_ROOM.matcher(roomName);
        if (team.matches()) {
            Long sessionId = Long.valueOf(team.group(1));
            Long teamId = Long.valueOf(team.group(2));
            if (isTeacher && joined) {
                // 배정 종료 규칙 ⑵는 "다른 수업 입장"이 조건이다. 같은 수업 안에서 팀만 옮기는
                // 순회까지 끊으면, 방금 배정된 대기 학생이 CHAT_ASSIGNED 직후 CHAT_ENDED 를
                // 받고 대기열에서도 빠진다 (A팀 퇴장 drain → B팀 입장 end, S15P11A407-132).
                // 마지막 수업과 비교해 실제로 넘어갈 때만 종료한다.
                presenceService.lastSessionOfTeacher(userId)
                        .filter(previous -> !previous.equals(sessionId))
                        .ifPresent(previous -> chatRouterService.endConversationsOf(userId));
                presenceService.teacherEnteredTeamRoom(sessionId, teamId, userId);
            } else if (isTeacher) {
                presenceService.teacherLeftTeamRoom(sessionId, teamId, userId);
                // 한가해진 순간 — 대기 중인 학생이 있으면 이 선생님에게 연결
                chatRouterService.drainWaitingQueue(userId);
            } else if (joined) {
                // 이전에 발급된 unrestricted 토큰으로 재접속해도 Redis 잠금을 다시 강제한다.
                mediaControlService.reapplyMediaLocksOnJoin(
                        sessionId, roomName, userId);
                presenceService.studentEnteredTeamRoom(sessionId, teamId, userId);
            } else {
                presenceService.studentLeftTeamRoom(sessionId, userId);
            }
        }
    }

    /**
     * 출석은 메인 룸 입퇴장 기준. 재입장 = 새 행 (이력 보존)
     *
     * <p>입장 때 그 사람의 열린 행을 먼저 닫는다. 회선이 불안정하면 ICE 재연결이 반복되는데
     * (실측: 90분에 한 사람이 80회) join 웹훅은 매번 오지만 leave 는 유실될 수 있어 열린 행이
     * 쌓인다. 그러면 같은 사람이 "접속 중"으로 여러 번 잡혀 인원과 출석 시간이 부풀려진다.
     * 한 사람의 열린 행은 언제나 최대 하나여야 한다.</p>
     */
    private void recordAttendance(Long sessionId, Long userId, boolean joined) {
        if (joined) {
            LocalDateTime now = LocalDateTime.now();
            sessionParticipantRepository.markLeft(sessionId, userId, now);
            LiveSession session = liveSessionRepository.getReferenceById(sessionId);
            sessionParticipantRepository.save(
                    SessionParticipant.join(session, userRepository.getReferenceById(userId)));
        } else {
            sessionParticipantRepository
                    .findFirstBySessionIdAndUserIdAndLeftAtIsNullOrderByJoinedAtDesc(sessionId, userId)
                    .ifPresent(SessionParticipant::leave);
        }
    }
}
