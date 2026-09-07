package com.mallang.auth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/**
 * 비밀번호 재설정 토큰 — Redis 에 짧게 보관한다.
 *
 * <p>메일로 나가는 링크 하나가 곧 계정 접근 권한이므로 세 가지를 지킨다:
 * <b>단회용</b>(쓰는 즉시 삭제), <b>짧은 수명</b>, <b>추측 불가</b>(256비트 난수).</p>
 *
 * <p>Redis 에는 토큰이 아니라 <b>토큰의 SHA-256 해시</b>를 키로 둔다. 저장소를 읽을 수
 * 있는 사람이 곧바로 남의 계정을 가져가지 못하게 하려는 것이다 — 비밀번호를 해시로
 * 저장하는 것과 같은 이유다. 원본 토큰은 메일에만 존재한다.</p>
 */
@Service
@RequiredArgsConstructor
public class PasswordResetTokenService {

    private static final String KEY_PREFIX = "pwreset:";

    private final StringRedisTemplate redis;
    private final SecureRandom random = new SecureRandom();

    @Value("${mallang.password-reset.token-validity}")
    private Duration tokenValidity;

    /** 새 토큰을 발급하고 원본을 돌려준다 (저장되는 것은 해시다) */
    public String issue(Long userId) {
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        redis.opsForValue().set(key(token), String.valueOf(userId), tokenValidity);
        return token;
    }

    /**
     * 토큰을 쓰고 폐기한다. 유효하면 userId, 아니면 null.
     *
     * <p>조회와 삭제를 {@code getAndDelete} 로 한 번에 처리한다. 따로 하면 같은 링크로
     * 동시에 두 번 들어왔을 때 둘 다 통과할 수 있다.</p>
     */
    public Long consume(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        String userId = redis.opsForValue().getAndDelete(key(token));
        if (userId == null) {
            return null;
        }
        try {
            return Long.valueOf(userId);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public Duration getTokenValidity() {
        return tokenValidity;
    }

    private String key(String token) {
        return KEY_PREFIX + sha256(token);
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 은 모든 JVM 이 반드시 제공한다 — 여기 오면 런타임이 깨진 것이다
            throw new IllegalStateException("SHA-256 을 쓸 수 없습니다.", e);
        }
    }
}
