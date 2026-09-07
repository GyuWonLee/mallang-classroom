package com.mallang.tutor.service;

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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI 말랑이 하루 사용량 — S15P11A407-137
 *
 * <p>호출 하나가 곧 크레딧이다. 상한이 없으면 한 학생이 반 전체 몫을 태울 수 있어
 * 명세도 "비용 상한부터 정해야 한다"고 적어 두었다(§11.1 #1).</p>
 */
@ExtendWith(MockitoExtension.class)
class AiTutorQuotaTest {

    private static final Long STUDENT_ID = 20L;
    private static final String KEY = "ai:tutor:quota:20";

    @Mock StringRedisTemplate redis;
    @Mock ValueOperations<String, String> valueOperations;

    private AiTutorQuota quota;

    @BeforeEach
    void setUp() {
        quota = new AiTutorQuota(redis);
        lenient().when(redis.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    void allowsQuestionsUnderTheDailyLimit() {
        when(valueOperations.increment(KEY)).thenReturn((long) AiTutorQuota.DAILY_LIMIT);

        assertThatCode(() -> quota.check(STUDENT_ID)).doesNotThrowAnyException();
    }

    @Test
    void blocksOnceOverTheDailyLimit() {
        when(valueOperations.increment(KEY)).thenReturn(AiTutorQuota.DAILY_LIMIT + 1L);

        // 저학년이 읽는 문구다 — "429" 가 아니라 내일 다시 오라고 말한다
        assertThatThrownBy(() -> quota.check(STUDENT_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("내일 또 만나요");
    }

    @Test
    void startsTheDayOnTheFirstQuestion() {
        when(valueOperations.increment(KEY)).thenReturn(1L);

        quota.check(STUDENT_ID);

        verify(redis).expire(KEY, Duration.ofDays(1));
    }

    @Test
    void doesNotPushTheWindowOnLaterQuestions() {
        when(valueOperations.increment(KEY)).thenReturn(2L);

        quota.check(STUDENT_ID);

        // 매번 만료를 다시 걸면 창이 밀려 하루가 영원히 끝나지 않는다
        verify(redis, never()).expire(eq(KEY), any(Duration.class));
    }

    @Test
    void redisOutageDoesNotBlockLearning() {
        when(valueOperations.increment(KEY)).thenThrow(new RuntimeException("redis down"));

        // 사용량을 못 센다고 학습 도구 자체를 막지는 않는다 — 대신 로그로 비용을 확인할 수 있게 한다
        assertThatCode(() -> quota.check(STUDENT_ID)).doesNotThrowAnyException();
    }
}
