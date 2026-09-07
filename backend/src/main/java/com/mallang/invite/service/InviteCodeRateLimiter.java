package com.mallang.invite.service;

import com.mallang.global.error.ApiException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 초대 코드 열거 방어 (명세 §11.1 #2).
 *
 * <p>미리보기는 미가입 학생이 쓰는 공개 엔드포인트라 인증으로 막을 수 없다. 코드가
 * 31자 문자셋 6자리라 무제한 조회를 허용하면 유효 코드를 기계로 훑어낼 여지가 생긴다.
 * IP 당 1분 창으로 제한한다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class InviteCodeRateLimiter {

    private static final int MAX_PER_WINDOW = 20;
    private static final Duration WINDOW = Duration.ofMinutes(1);
    private static final String KEY_PREFIX = "invite:preview:";

    private final StringRedisTemplate redis;

    public void check(String clientIp) {
        if (clientIp == null || clientIp.isBlank()) {
            return; // IP 를 못 얻는 경로(프록시 설정 누락 등)까지 막으면 정상 가입이 끊긴다
        }
        String key = KEY_PREFIX + clientIp;
        long count;
        try {
            Long incremented = redis.opsForValue().increment(key);
            count = incremented == null ? 1L : incremented;
            if (count == 1L) {
                // 첫 호출에만 TTL 을 건다. 매번 걸면 창이 계속 밀려 영원히 만료되지 않는다.
                redis.expire(key, WINDOW);
            }
        } catch (RuntimeException e) {
            // Redis 가 죽었다고 가입 경로 전체를 막으면 피해가 더 크다 — 열어 두고 흔적만 남긴다.
            log.warn("초대 미리보기 레이트리밋 확인 실패 — 이번 요청은 통과시킨다. ip={}", clientIp, e);
            return;
        }
        if (count > MAX_PER_WINDOW) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too-many-requests",
                    "잠시 후 다시 시도해 주세요.");
        }
    }
}
