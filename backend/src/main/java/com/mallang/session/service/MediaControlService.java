package com.mallang.session.service;

import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.dto.SessionDtos.MediaAction;
import com.mallang.session.dto.SessionDtos.MediaControlRequest;
import com.mallang.session.dto.SessionDtos.MediaTarget;
import com.mallang.session.service.MediaControlTargetResolver.ResolvedMediaControl;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** LiveKit Server API를 통한 수업 미디어 강제 제어. */
@Service
@RequiredArgsConstructor
public class MediaControlService {

    private final MediaControlTargetResolver targetResolver;
    private final LiveKitRoomService liveKitRoomService;
    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redis;

    /** DB 검증 트랜잭션이 끝난 뒤 LiveKit·Redis를 호출해 DB 커넥션을 점유하지 않는다. */
    public void control(Long sessionId, MediaControlRequest request, AuthUser authUser) {
        List<ResolvedMediaControl> targets = targetResolver.resolve(
                sessionId, request, authUser);
        if (isRequestAction(request.action())) {
            requestMedia(sessionId, request, targets);
            return;
        }
        List<ResolvedMediaControl> successfulTargets = new ArrayList<>(targets.size());
        for (ResolvedMediaControl target : targets) {
            try {
                controlTarget(request.action(), target);
                successfulTargets.add(target);
            } catch (RuntimeException controlFailure) {
                publishPartialSuccess(sessionId, request, successfulTargets, controlFailure);
                throw controlFailure;
            }
        }
        publishMediaControl(sessionId, request, successfulTargets);
    }

    private boolean isRequestAction(MediaAction action) {
        return action == MediaAction.REQUEST_UNMUTE_MIC || action == MediaAction.REQUEST_ENABLE_CAM;
    }

    /**
     * 켜 달라는 요청. 잠금/해제와 달리 서버가 강제할 수 없다 — 브라우저는 사용자 제스처 없이
     * 마이크·카메라를 켜 주지 않는다. 그래서 LiveKit 권한도 Redis 잠금도 건드리지 않고,
     * 학생 화면에 요청을 띄우는 이벤트만 보낸다.
     *
     * <p>선생님이 잠가 둔 학생은 대상에서 뺀다 — 잠가 놓고 켜 달라는 건 모순이고, 학생은
     * 응할 방법이 없다. 이 경우 필요한 건 요청이 아니라 잠금 해제다. 지목(PARTICIPANT)이면
     * 409 로 알려 주고, 일괄(TEAM·ALL)이면 조용히 건너뛴다 — 팀 미배정 학생을 다루는 기존 규약과 같다.</p>
     */
    private void requestMedia(Long sessionId, MediaControlRequest request,
                              List<ResolvedMediaControl> targets) {
        String lockKey = request.action() == MediaAction.REQUEST_UNMUTE_MIC
                ? SessionRedisKeys.mutedMic(sessionId)
                : SessionRedisKeys.disabledCam(sessionId);

        List<ResolvedMediaControl> askable = targets.stream()
                .filter(target -> !isLocked(lockKey, String.valueOf(target.studentId())))
                .toList();

        if (askable.isEmpty() && request.target() == MediaTarget.PARTICIPANT) {
            throw new ApiException(HttpStatus.CONFLICT, "media-locked",
                    "잠금을 먼저 해제해야 켜 달라고 요청할 수 있습니다.");
        }
        publishMediaEvent(sessionId, StompEventType.MEDIA_REQUEST, request, askable);
    }

    private void controlTarget(MediaAction action, ResolvedMediaControl target) {
        String member = String.valueOf(target.studentId());
        String mutedMicKey = SessionRedisKeys.mutedMic(target.sessionId());
        String disabledCamKey = SessionRedisKeys.disabledCam(target.sessionId());
        boolean microphoneLocked = isLocked(mutedMicKey, member);
        boolean cameraLocked = isLocked(disabledCamKey, member);

        switch (action) {
            case MUTE_MIC -> microphoneLocked = true;
            case UNLOCK_MIC -> microphoneLocked = false;
            case DISABLE_CAM -> cameraLocked = true;
            case UNLOCK_CAM -> cameraLocked = false;
            default -> throw new IllegalStateException("검증되지 않은 미디어 제어 동작입니다.");
        }

        liveKitRoomService.applyMediaControl(
                target.roomName(), target.identity(), microphoneLocked, cameraLocked, action);
        updateRedisState(action, mutedMicKey, disabledCamKey, member);
    }

    private void publishMediaControl(Long sessionId, MediaControlRequest request,
                                     List<ResolvedMediaControl> targets) {
        publishMediaEvent(sessionId, StompEventType.MEDIA_CONTROL, request, targets);
    }

    /** 잠금 결과(MEDIA_CONTROL)와 켜기 요청(MEDIA_REQUEST)이 같은 payload 를 쓴다. */
    private void publishMediaEvent(Long sessionId, String type, MediaControlRequest request,
                                   List<ResolvedMediaControl> targets) {
        if (targets.isEmpty()) {
            return;
        }
        List<Long> userIds = targets.stream()
                .map(ResolvedMediaControl::studentId)
                .toList();
        messagingTemplate.convertAndSend("/sub/sessions/" + sessionId,
                StompEnvelope.of(type, Map.of(
                        "target", request.target().name(),
                        "action", request.action().name(),
                        "userIds", userIds)));
    }

    /**
     * 일괄 제어가 중간에 실패해도 이미 변경된 학생의 화면 상태는 즉시 동기화한다.
     * 이벤트 발행 실패가 원래 LiveKit/Redis 예외를 가리지 않도록 suppressed로 보존한다.
     */
    private void publishPartialSuccess(Long sessionId, MediaControlRequest request,
                                       List<ResolvedMediaControl> successfulTargets,
                                       RuntimeException controlFailure) {
        try {
            publishMediaControl(sessionId, request, successfulTargets);
        } catch (RuntimeException publishFailure) {
            controlFailure.addSuppressed(publishFailure);
        }
    }

    /**
     * 제한 전 발급된 토큰으로 학생이 팀 룸에 재접속해도 Redis 잠금을 다시 적용한다.
     * LiveKit participant_joined 웹훅의 학생 팀 룸 입장 경로에서만 호출한다.
     */
    public void reapplyMediaLocksOnJoin(Long sessionId, String roomName, Long studentId) {
        String redisMember = String.valueOf(studentId);
        boolean microphoneLocked = isLocked(
                SessionRedisKeys.mutedMic(sessionId), redisMember);
        boolean cameraLocked = isLocked(
                SessionRedisKeys.disabledCam(sessionId), redisMember);
        if (microphoneLocked || cameraLocked) {
            liveKitRoomService.applyMediaLocks(
                    roomName, SessionTicketService.identity(false, studentId),
                    microphoneLocked, cameraLocked);
        }
    }

    private boolean isLocked(String key, String member) {
        return Boolean.TRUE.equals(redis.opsForSet().isMember(key, member));
    }

    private void updateRedisState(MediaAction action, String mutedMicKey,
                                  String disabledCamKey, String member) {
        switch (action) {
            case MUTE_MIC -> redis.opsForSet().add(mutedMicKey, member);
            case UNLOCK_MIC -> redis.opsForSet().remove(mutedMicKey, member);
            case DISABLE_CAM -> redis.opsForSet().add(disabledCamKey, member);
            case UNLOCK_CAM -> redis.opsForSet().remove(disabledCamKey, member);
            default -> throw new IllegalStateException("검증되지 않은 미디어 제어 동작입니다.");
        }
    }

}
