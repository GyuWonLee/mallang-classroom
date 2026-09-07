package com.mallang.session.service;

import com.mallang.global.error.ApiException;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;

/**
 * LiveKit 웹훅 서명 검증 — Authorization 헤더의 JWT를 API 시크릿으로 검증하고
 * 본문 SHA-256 해시(sha256 클레임)까지 대조한다. 위조 요청으로 출석 조작·대화 강제 종료를 막는 방벽.
 * 키 미설정(로컬 개발) 시 검증을 건너뛰되 경고 로그를 남긴다 — 운영 env에는 항상 주입됨.
 */
@Slf4j
@Component
public class LiveKitWebhookVerifier {

    private final String apiKey;
    private final SecretKey secretKey;

    public LiveKitWebhookVerifier(
            @Value("${LIVEKIT_API_KEY:}") String apiKey,
            @Value("${LIVEKIT_API_SECRET:}") String apiSecret) {
        this.apiKey = apiKey;
        this.secretKey = apiSecret.isBlank()
                ? null
                : Keys.hmacShaKeyFor(apiSecret.getBytes(StandardCharsets.UTF_8));
        if (this.secretKey == null) {
            log.warn("LIVEKIT_API_SECRET 미설정 — 웹훅 서명 검증이 비활성화됩니다 (로컬 개발 전용 상태)");
        }
    }

    public void verify(String authorizationHeader, String rawBody) {
        if (secretKey == null) {
            return;
        }
        if (authorizationHeader == null || authorizationHeader.isBlank()) {
            throw unauthorized();
        }
        String token = authorizationHeader.startsWith("Bearer ")
                ? authorizationHeader.substring(7) : authorizationHeader;
        Claims claims;
        try {
            claims = Jwts.parser().verifyWith(secretKey).build()
                    .parseSignedClaims(token).getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            throw unauthorized();
        }
        if (!apiKey.equals(claims.getIssuer())) {
            throw unauthorized();
        }
        String expected = claims.get("sha256", String.class);
        byte[] digest = sha256(rawBody);
        String base64 = Base64.getEncoder().encodeToString(digest);
        String hex = HexFormat.of().formatHex(digest);
        // LiveKit SDK는 base64 해시를 사용 — 혹시 모를 버전 차이 대비 hex도 허용 (서명 검증이 주 방벽)
        if (expected == null || (!expected.equals(base64) && !expected.equalsIgnoreCase(hex))) {
            throw unauthorized();
        }
    }

    private byte[] sha256(String body) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 미지원 환경", e);
        }
    }

    private ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "invalid-webhook-signature",
                "웹훅 서명 검증에 실패했습니다");
    }
}
