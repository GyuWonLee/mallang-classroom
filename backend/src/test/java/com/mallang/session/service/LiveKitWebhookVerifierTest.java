package com.mallang.session.service;

import com.mallang.global.error.ApiException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Date;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * LiveKit 웹훅 서명 검증.
 *
 * <p>이 엔드포인트는 인증 없이 공개돼 있다(LiveKit 서버가 부른다). 서명이 뚫리면 출석을
 * 조작하거나 남의 상담을 강제 종료시킬 수 있으므로, 여기가 유일한 방벽이다.</p>
 */
class LiveKitWebhookVerifierTest {

    private static final String API_KEY = "devkey";
    private static final String API_SECRET = "secret-that-is-long-enough-for-hmac-sha256!!";
    private static final String BODY = "{\"event\":\"participant_joined\"}";

    private final LiveKitWebhookVerifier verifier =
            new LiveKitWebhookVerifier(API_KEY, API_SECRET);

    @Test
    void acceptsAProperlySignedRequest() {
        String token = token(API_KEY, base64Sha256(BODY), API_SECRET);

        assertThatCode(() -> verifier.verify("Bearer " + token, BODY))
                .doesNotThrowAnyException();
    }

    @Test
    void acceptsATokenWithoutTheBearerPrefix() {
        String token = token(API_KEY, base64Sha256(BODY), API_SECRET);

        // LiveKit 버전에 따라 접두사가 없을 수 있다
        assertThatCode(() -> verifier.verify(token, BODY)).doesNotThrowAnyException();
    }

    @Test
    void acceptsHexEncodedHashToo() {
        byte[] digest = sha256(BODY);
        String token = token(API_KEY, HexFormat.of().formatHex(digest), API_SECRET);

        assertThatCode(() -> verifier.verify("Bearer " + token, BODY))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsATokenSignedWithAnotherSecret() {
        String forged = token(API_KEY, base64Sha256(BODY),
                "a-completely-different-secret-value-32bytes!!");

        assertThatThrownBy(() -> verifier.verify("Bearer " + forged, BODY))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("서명 검증");
    }

    @Test
    void rejectsATokenIssuedByAnotherApiKey() {
        String token = token("someone-else", base64Sha256(BODY), API_SECRET);

        assertThatThrownBy(() -> verifier.verify("Bearer " + token, BODY))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsABodySwappedAfterSigning() {
        String token = token(API_KEY, base64Sha256(BODY), API_SECRET);

        // 서명은 그대로 두고 본문만 바꿔치기하는 공격 — sha256 클레임이 막는다
        assertThatThrownBy(() -> verifier.verify(
                "Bearer " + token, "{\"event\":\"participant_left\"}"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsATokenWithNoBodyHash() {
        String token = Jwts.builder().issuer(API_KEY)
                .expiration(new Date(System.currentTimeMillis() + 60_000))
                .signWith(key(API_SECRET)).compact();

        assertThatThrownBy(() -> verifier.verify("Bearer " + token, BODY))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void rejectsMissingOrGarbageAuthorization() {
        assertThatThrownBy(() -> verifier.verify(null, BODY)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> verifier.verify("  ", BODY)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> verifier.verify("Bearer not-a-jwt", BODY))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void skipsVerificationWhenNoSecretIsConfigured() {
        // 로컬 개발용 — 시크릿이 없으면 검증을 건너뛴다(생성자가 경고를 남긴다).
        // 운영 env 에는 항상 주입되므로 이 경로는 로컬에서만 탄다.
        LiveKitWebhookVerifier unconfigured = new LiveKitWebhookVerifier("", "");

        assertThatCode(() -> unconfigured.verify(null, BODY)).doesNotThrowAnyException();
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private String token(String issuer, String bodyHash, String secret) {
        return Jwts.builder()
                .issuer(issuer)
                .claim("sha256", bodyHash)
                .expiration(new Date(System.currentTimeMillis() + 60_000))
                .signWith(key(secret))
                .compact();
    }

    private SecretKey key(String secret) {
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    private String base64Sha256(String body) {
        return Base64.getEncoder().encodeToString(sha256(body));
    }

    private byte[] sha256(String body) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(body.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
