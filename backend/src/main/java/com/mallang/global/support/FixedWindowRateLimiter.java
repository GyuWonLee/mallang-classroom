package com.mallang.global.support;

import com.mallang.global.error.ApiException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 고정 창(fixed window) 방식 호출 제한.
 *
 * <p>인증으로 막을 수 없는 공개 엔드포인트에서 열거·남용을 막는 용도다. 한도와 창을
 * 호출자가 정하므로 용도마다 다른 정책을 줄 수 있다.</p>
 *
 * <p>Redis 가 죽으면 <b>통과시킨다.</b> 제한 장치가 고장 났다고 로그인·가입 경로 전체를
 * 막으면 피해가 더 크기 때문이다. 대신 흔적을 남겨 뒤늦게라도 알아챌 수 있게 한다.</p>
 *
 * <p>같은 방식이 {@code InviteCodeRateLimiter} 에도 있다. 그쪽은 이미 운영 중이라
 * 이번 변경에서 건드리지 않았다 — 나중에 이 컴포넌트로 합치면 된다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FixedWindowRateLimiter {

    private final StringRedisTemplate redis;

    /**
     * @param bucket 용도 구분 (키 접두사)
     * @param key    셀 기준 — IP, 이메일 등
     * @param max    창 안에서 허용할 최대 횟수
     * @param window 창 길이
     */
    public void check(String bucket, String key, int max, Duration window) {
        if (key == null || key.isBlank()) {
            // 기준값을 못 얻는 경로(프록시 설정 누락 등)까지 막으면 정상 사용자가 끊긴다
            return;
        }
        String redisKey = "ratelimit:" + bucket + ":" + key;
        long count;
        try {
            Long incremented = redis.opsForValue().increment(redisKey);
            count = incremented == null ? 1L : incremented;
            if (count == 1L) {
                // 첫 호출에만 TTL 을 건다. 매번 걸면 창이 계속 밀려 영원히 만료되지 않는다.
                redis.expire(redisKey, window);
            }
        } catch (RuntimeException e) {
            log.warn("레이트리밋 확인 실패 — 이번 요청은 통과시킨다. bucket={}", bucket, e);
            return;
        }
        if (count > max) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too-many-requests",
                    "잠시 후 다시 시도해 주세요.");
        }
    }
}
