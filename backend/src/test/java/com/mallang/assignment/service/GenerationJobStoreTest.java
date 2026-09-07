package com.mallang.assignment.service;

import com.mallang.assignment.ai.AiProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI 생성 작업 저장소.
 *
 * <p>확정 전 초안은 DB 어디에도 없고 이 Redis 값에만 있다. TTL 이 잘못 붙으면 선생님이
 * 검수하러 돌아왔을 때 초안이 사라져 있고, 직렬화가 깨지면 생성 결과를 통째로 잃는다.</p>
 */
@ExtendWith(MockitoExtension.class)
class GenerationJobStoreTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    @Mock StringRedisTemplate redis;
    @Mock ValueOperations<String, String> valueOps;

    @BeforeEach
    void setUp() {
        lenient().when(redis.opsForValue()).thenReturn(valueOps);
    }

    @Test
    void savesUnderTheJobKeyWithTheConfiguredTtl() {
        GenerationJobStore store = store(Duration.ofMinutes(30));

        store.save(GenerationJob.queued("job-1", 5L, 1L));

        verify(valueOps).set(eq("genjob:job-1"), anyString(), eq(Duration.ofMinutes(30)));
    }

    @Test
    void fallsBackToADayWhenNoTtlIsConfigured() {
        GenerationJobStore store = store(null);

        store.save(GenerationJob.queued("job-1", 5L, 1L));

        // TTL 이 없으면 초안이 영원히 남아 Redis 가 계속 자란다 — 기본값이 필요하다
        verify(valueOps).set(eq("genjob:job-1"), anyString(), eq(Duration.ofHours(24)));
    }

    @Test
    void readsBackWhatItWrote() {
        GenerationJobStore store = store(Duration.ofMinutes(30));
        GenerationJob done = GenerationJob.queued("job-1", 5L, 1L)
                .done(objectMapper.readTree("{\"problems\":[{\"no\":1}]}"));
        when(valueOps.get("genjob:job-1"))
                .thenReturn(objectMapper.writeValueAsString(done));

        GenerationJob found = store.find("job-1").orElseThrow();

        assertThat(found.status()).isEqualTo(JobStatus.DONE);
        assertThat(found.classroomId()).isEqualTo(5L);
        assertThat(found.draft().path("problems").get(0).path("no").asInt()).isEqualTo(1);
    }

    @Test
    void expiredOrUnknownJobIsEmpty() {
        GenerationJobStore store = store(Duration.ofMinutes(30));
        when(valueOps.get("genjob:gone")).thenReturn(null);

        // TTL 로 사라진 것과 없는 것을 구분하지 않는다 — 화면에서는 둘 다 "만료됐어요"다
        assertThat(store.find("gone")).isEmpty();
    }

    @Test
    void corruptedValueFailsLoudly() {
        GenerationJobStore store = store(Duration.ofMinutes(30));
        when(valueOps.get("genjob:job-1")).thenReturn("{ 깨진 JSON");

        // 조용히 empty 로 넘기면 "만료됐다"고 잘못 안내하게 된다
        assertThatThrownBy(() -> store.find("job-1"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("역직렬화");
    }

    @Test
    void failedJobKeepsItsReason() {
        GenerationJobStore store = store(Duration.ofMinutes(30));
        GenerationJob failed = GenerationJob.queued("job-1", 5L, 1L).failed("LLM 호출 실패");
        when(valueOps.get("genjob:job-1"))
                .thenReturn(objectMapper.writeValueAsString(failed));

        GenerationJob found = store.find("job-1").orElseThrow();

        assertThat(found.status()).isEqualTo(JobStatus.FAILED);
        assertThat(found.error()).isEqualTo("LLM 호출 실패");
        // JSON 의 null 은 Java null 이 아니라 NullNode 로 돌아온다 — 초안이 없다는 뜻은 같다
        assertThat(found.draft() == null || found.draft().isNull()).isTrue();
    }

    @Test
    void runningJobHasNoDraftYet() {
        GenerationJob running = GenerationJob.queued("job-1", 5L, 1L).running();

        assertThat(running.status()).isEqualTo(JobStatus.RUNNING);
        assertThat(running.draft()).isNull();
        assertThat(running.error()).isNull();
    }

    private GenerationJobStore store(Duration ttl) {
        return new GenerationJobStore(redis, objectMapper,
                new AiProperties("stub", null, null, null, ttl));
    }
}
