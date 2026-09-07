package com.mallang.invite.service;

import com.mallang.global.error.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 초대 코드 열거 방어 — S15P11A407-137
 *
 * <p>미리보기는 공개 엔드포인트라 6자리 코드를 기계로 훑을 수 있다. 코드 문자셋이
 * 31자 6자리(약 9억)라 무제한이면 유효 코드를 찾아낼 여지가 생긴다.</p>
 */
@ExtendWith(MockitoExtension.class)
class InviteCodeRateLimiterTest {

    private static final String IP = "203.0.113.7";
    private static final String KEY = "invite:preview:203.0.113.7";

    @Mock StringRedisTemplate redis;
    @Mock ValueOperations<String, String> valueOperations;

    private InviteCodeRateLimiter limiter;

    @BeforeEach
    void setUp() {
        limiter = new InviteCodeRateLimiter(redis);
        lenient().when(redis.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    void allowsCallsUnderTheLimit() {
        when(valueOperations.increment(KEY)).thenReturn(5L);

        assertThatCode(() -> limiter.check(IP)).doesNotThrowAnyException();
    }

    @Test
    void rejectsOnceOverTheLimit() {
        when(valueOperations.increment(KEY)).thenReturn(21L);

        assertThatThrownBy(() -> limiter.check(IP))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("잠시 후");
    }

    @Test
    void startsTheWindowOnTheFirstCall() {
        when(valueOperations.increment(KEY)).thenReturn(1L);

        limiter.check(IP);

        // 첫 호출에만 TTL 을 건다 — 매번 걸면 창이 계속 밀려 영원히 만료되지 않는다
        verify(redis).expire(KEY, Duration.ofMinutes(1));
    }

    @Test
    void doesNotResetTheWindowOnLaterCalls() {
        when(valueOperations.increment(KEY)).thenReturn(2L);

        limiter.check(IP);

        verify(redis, never()).expire(eq(KEY), org.mockito.ArgumentMatchers.any(Duration.class));
    }

    @Test
    void redisOutageDoesNotBlockLegitimateStudents() {
        when(valueOperations.increment(KEY)).thenThrow(new RuntimeException("redis down"));

        // 레이트리밋이 죽었다고 가입 경로 전체를 막으면 피해가 더 크다 — 열어 두고 로그만 남긴다
        assertThatCode(() -> limiter.check(IP)).doesNotThrowAnyException();
    }

    @Test
    void missingClientIpIsNotRateLimited() {
        assertThatCode(() -> limiter.check(null)).doesNotThrowAnyException();

        verify(valueOperations, never()).increment(org.mockito.ArgumentMatchers.anyString());
    }
}
