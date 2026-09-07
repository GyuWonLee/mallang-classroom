package com.mallang.assignment.service;

import com.mallang.assignment.ai.AiProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.Optional;

/** genjob:{jobId} — AI 생성 작업 상태·초안 저장소 (Redis, TTL은 ai.job-ttl). */
@Component
@RequiredArgsConstructor
public class GenerationJobStore {

    private static final String KEY_PREFIX = "genjob:";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final AiProperties properties;

    public void save(GenerationJob job) {
        Duration ttl = properties.jobTtl() != null ? properties.jobTtl() : Duration.ofHours(24);
        redis.opsForValue().set(key(job.jobId()), serialize(job), ttl);
    }

    public Optional<GenerationJob> find(String jobId) {
        String json = redis.opsForValue().get(key(jobId));
        if (json == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(objectMapper.readValue(json, GenerationJob.class));
        } catch (JacksonException e) {
            throw new IllegalStateException("생성 작업 상태를 역직렬화할 수 없습니다.", e);
        }
    }

    private String serialize(GenerationJob job) {
        try {
            return objectMapper.writeValueAsString(job);
        } catch (JacksonException e) {
            throw new IllegalStateException("생성 작업 상태를 직렬화할 수 없습니다.", e);
        }
    }

    private String key(String jobId) {
        return KEY_PREFIX + jobId;
    }
}
