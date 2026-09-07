package com.mallang.session.service;

import com.mallang.global.error.ApiException;
import io.livekit.server.AccessToken;
import io.livekit.server.CanPublish;
import io.livekit.server.CanPublishData;
import io.livekit.server.CanPublishSources;
import io.livekit.server.CanSubscribe;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;

/**
 * Creates short-lived LiveKit room tickets. The API secret stays on the backend;
 * clients receive only the signed ticket returned by this service.
 */
@Service
public class LiveKitTokenService {

    private static final List<String> ALL_PUBLISH_SOURCES = List.of(
            "camera", "microphone", "screen_share", "screen_share_audio");
    static final List<String> PUBLISH_SOURCES_WITHOUT_MICROPHONE =
            allowedPublishSources(true, false);
    static final List<String> PUBLISH_SOURCES_WITHOUT_CAMERA =
            allowedPublishSources(false, true);
    static final List<String> PUBLISH_SOURCES_WITHOUT_MICROPHONE_AND_CAMERA =
            allowedPublishSources(true, true);

    private final String apiKey;
    private final String apiSecret;
    private final Duration tokenValidity;

    public LiveKitTokenService(
            @Value("${livekit.api-key:}") String apiKey,
            @Value("${livekit.api-secret:}") String apiSecret,
            @Value("${livekit.token-validity:PT5M}") Duration tokenValidity) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.tokenValidity = tokenValidity;
    }

    public String issueRoomTicket(String roomName, String identity, String displayName,
                                  boolean canPublish) {
        return issueRoomTicket(roomName, identity, displayName, canPublish, null);
    }

    public String issueRoomTicket(String roomName, String identity, String displayName,
                                  boolean canPublish, List<String> canPublishSources) {
        requireConfigured();

        AccessToken token = new AccessToken(apiKey, apiSecret);
        token.setIdentity(identity);
        token.setName(displayName);
        token.setTtl(tokenValidity.toMillis());
        token.addGrants(
                new RoomJoin(true),
                new RoomName(roomName),
                new CanSubscribe(true),
                new CanPublish(canPublish),
                new CanPublishData(false)
        );
        if (canPublish && canPublishSources != null) {
            token.addGrants(new CanPublishSources(canPublishSources));
        }
        return token.toJwt();
    }

    /** 잠긴 장치만 제외하고 화면 공유 권한은 항상 유지한다. 제한이 없으면 null을 반환한다. */
    static List<String> allowedPublishSources(boolean microphoneLocked, boolean cameraLocked) {
        if (!microphoneLocked && !cameraLocked) {
            return null;
        }
        return ALL_PUBLISH_SOURCES.stream()
                .filter(source -> !microphoneLocked || !"microphone".equals(source))
                .filter(source -> !cameraLocked || !"camera".equals(source))
                .toList();
    }

    private void requireConfigured() {
        if (apiKey.isBlank() || apiSecret.isBlank()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "livekit-not-configured",
                    "LiveKit API credentials are not configured.");
        }
    }
}
