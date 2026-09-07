package com.mallang.report.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 리포트 코멘트 캐시.
 *
 * <p>학습현황 첫 로딩 지연의 원인은 SQL 이 아니라 GMS 왕복이었다 — 운영 실측 1.07~1.88초,
 * 같은 시점 운영 DB 의 제출은 8건. 그래서 최적화 대상이 쿼리가 아니라 이 호출이다.</p>
 */
@ExtendWith(MockitoExtension.class)
class ReportCommentCacheTest {

    private static final List<String> STRENGTHS = List.of("겹받침", "문장부호");
    private static final List<String> WEAKNESSES = List.of("띄어쓰기");

    @Mock StringRedisTemplate redis;
    @Mock ValueOperations<String, String> valueOperations;

    private ReportCommentCache cache;

    @BeforeEach
    void setUp() {
        cache = new ReportCommentCache(redis);
        lenient().when(redis.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    void servesFromCacheWithoutCallingGms() {
        when(valueOperations.get(anyString())).thenReturn("캐시된 코멘트");
        AtomicInteger calls = new AtomicInteger();

        String comment = cache.get(STRENGTHS, WEAKNESSES, () -> {
            calls.incrementAndGet();
            return "새로 만든 코멘트";
        });

        assertThat(comment).isEqualTo("캐시된 코멘트");
        // 적중했는데도 생성기를 부르면 캐시가 아무 의미가 없다 (1.5초가 그대로 남는다)
        assertThat(calls).hasValue(0);
    }

    @Test
    void generatesAndStoresOnMiss() {
        when(valueOperations.get(anyString())).thenReturn(null);

        String comment = cache.get(STRENGTHS, WEAKNESSES, () -> "새로 만든 코멘트");

        assertThat(comment).isEqualTo("새로 만든 코멘트");
        verify(valueOperations).set(anyString(), eq("새로 만든 코멘트"), any(Duration.class));
    }

    @Test
    void doesNotCacheGenerationFailure() {
        when(valueOperations.get(anyString())).thenReturn(null);

        String comment = cache.get(STRENGTHS, WEAKNESSES, () -> null);

        assertThat(comment).isNull();
        // 일시적인 GMS 장애로 나온 폴백 문구가 TTL 동안 굳으면, GMS 가 살아나도 LLM 코멘트가 안 나온다
        verify(valueOperations, never()).set(anyString(), anyString(), any(Duration.class));
    }

    @Test
    void sameConceptsInDifferentOrderShareOneKey() {
        when(valueOperations.get(anyString())).thenReturn(null);

        cache.get(List.of("겹받침", "문장부호"), WEAKNESSES, () -> "코멘트");
        cache.get(List.of("문장부호", "겹받침"), WEAKNESSES, () -> "코멘트");

        // 강·약점 목록의 순서는 제출 순서를 타고 온다. 순서 때문에 캐시가 빗나가면 안 된다
        ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
        verify(valueOperations, times(2)).get(keys.capture());
        assertThat(keys.getAllValues().get(0)).isEqualTo(keys.getAllValues().get(1));
    }

    @Test
    void differentWeaknessesUseDifferentKeys() {
        when(valueOperations.get(anyString())).thenReturn(null);

        cache.get(STRENGTHS, List.of("띄어쓰기"), () -> "코멘트");
        cache.get(STRENGTHS, List.of("받침규칙"), () -> "코멘트");

        // 키에 지문을 넣는 게 곧 무효화다 — 새 채점으로 약점이 바뀌면 옛 코멘트가 따라오면 안 된다
        ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
        verify(valueOperations, times(2)).get(keys.capture());
        assertThat(keys.getAllValues().get(0)).isNotEqualTo(keys.getAllValues().get(1));
    }

    @Test
    void redisOutageStillReturnsAComment() {
        when(valueOperations.get(anyString())).thenThrow(new RuntimeException("redis down"));

        // Redis 가 죽으면 캐시 이전 속도로 돌아갈 뿐, 리포트 자체가 막히면 안 된다
        assertThat(cache.get(STRENGTHS, WEAKNESSES, () -> "새로 만든 코멘트"))
                .isEqualTo("새로 만든 코멘트");
    }

    @Test
    void noDataAdviceSharesOneKeyForEveryone() {
        when(valueOperations.get(anyString())).thenReturn(null);

        cache.getNoData(() -> "안내");
        cache.getNoData(() -> "안내");

        // 입력이 없는 안내문이라 학급·학생과 무관하게 한 번만 만들면 된다
        ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
        verify(valueOperations, times(2)).get(keys.capture());
        assertThat(keys.getAllValues().get(0)).isEqualTo(keys.getAllValues().get(1));
    }
}
