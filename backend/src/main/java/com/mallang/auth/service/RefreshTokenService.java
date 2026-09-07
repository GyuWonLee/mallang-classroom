package com.mallang.auth.service;

import com.mallang.global.security.JwtTokenProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * refresh 토큰 저장소 (Redis).
 * 키: refresh:{userId}, TTL: refresh 토큰 유효기간과 동일.
 * 로그아웃 = 키 삭제 → 이후 그 refresh 토큰으로 재발급 불가.
 */
@Service
@RequiredArgsConstructor
public class RefreshTokenService {

    private static final String KEY_PREFIX = "refresh:";

    private final StringRedisTemplate redisTemplate;
    private final JwtTokenProvider jwtTokenProvider;

    public void save(Long userId, String refreshToken) {
        redisTemplate.opsForValue()
                .set(key(userId), refreshToken, jwtTokenProvider.getRefreshTokenValidity());
    }

    public boolean matches(Long userId, String refreshToken) {
        String stored = redisTemplate.opsForValue().get(key(userId));
        return refreshToken.equals(stored);
    }

    public void delete(Long userId) {
        redisTemplate.delete(key(userId));
    }

    private String key(Long userId) {
        return KEY_PREFIX + userId;
    }
}
