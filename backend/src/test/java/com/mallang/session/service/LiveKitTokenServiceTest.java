package com.mallang.session.service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LiveKitTokenServiceTest {

    private static final String SECRET =
            "livekit-test-secret-must-be-at-least-32-bytes-long";

    @Test
    void issuesTicketWithExpectedRoomIdentityAndPermissions() {
        LiveKitTokenService service = new LiveKitTokenService(
                "test-key", SECRET, Duration.ofMinutes(30));

        String ticket = service.issueRoomTicket(
                "session-10", "student-7", "Kim", false);

        Claims claims = Jwts.parser()
                .verifyWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .build()
                .parseSignedClaims(ticket)
                .getPayload();
        @SuppressWarnings("unchecked")
        Map<String, Object> video = claims.get("video", Map.class);

        assertThat(claims.getIssuer()).isEqualTo("test-key");
        assertThat(claims.getSubject()).isEqualTo("student-7");
        assertThat(claims.get("name", String.class)).isEqualTo("Kim");
        assertThat(video)
                .containsEntry("roomJoin", true)
                .containsEntry("room", "session-10")
                .containsEntry("canSubscribe", true)
                .containsEntry("canPublish", false)
                .containsEntry("canPublishData", false);
    }

    @Test
    void issuesRestrictedTicketWithoutMicrophonePublishSource() {
        LiveKitTokenService service = new LiveKitTokenService(
                "test-key", SECRET, Duration.ofMinutes(30));

        String ticket = service.issueRoomTicket(
                "session-10-team-3", "student-7", "Kim", true,
                LiveKitTokenService.PUBLISH_SOURCES_WITHOUT_MICROPHONE);

        Claims claims = Jwts.parser()
                .verifyWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .build()
                .parseSignedClaims(ticket)
                .getPayload();
        @SuppressWarnings("unchecked")
        Map<String, Object> video = claims.get("video", Map.class);

        assertThat(video)
                .containsEntry("canPublish", true)
                .containsEntry("canPublishSources", List.of(
                        "camera", "screen_share", "screen_share_audio"));
    }

    @Test
    void issuesRestrictedTicketWithoutCameraPublishSource() {
        LiveKitTokenService service = new LiveKitTokenService(
                "test-key", SECRET, Duration.ofMinutes(30));

        String ticket = service.issueRoomTicket(
                "session-10-team-3", "student-7", "Kim", true,
                LiveKitTokenService.PUBLISH_SOURCES_WITHOUT_CAMERA);

        Claims claims = Jwts.parser()
                .verifyWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .build()
                .parseSignedClaims(ticket)
                .getPayload();
        @SuppressWarnings("unchecked")
        Map<String, Object> video = claims.get("video", Map.class);

        assertThat(video)
                .containsEntry("canPublishSources", List.of(
                        "microphone", "screen_share", "screen_share_audio"));
    }

    @Test
    void combinedLocksKeepOnlyScreenSharePublishSources() {
        assertThat(LiveKitTokenService.allowedPublishSources(true, true))
                .containsExactly("screen_share", "screen_share_audio");
    }
}
