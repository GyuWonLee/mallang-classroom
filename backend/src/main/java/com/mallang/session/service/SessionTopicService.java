package com.mallang.session.service;

import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.SessionDtos.SessionTopicRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Map;
import java.util.TreeMap;

/** 진행 중인 수업의 학년별 주제를 Redis에 저장하고 조회한다. */
@Service
@RequiredArgsConstructor
public class SessionTopicService {

    /** 정상 종료 시 즉시 삭제하고, 비정상 종료에 대비해 24시간 뒤에도 자동 만료시킨다. */
    static final Duration TOPICS_TTL = Duration.ofHours(24);

    private final SessionStarterGuard sessionStarterGuard;
    private final StringRedisTemplate redis;

    public void update(Long sessionId, int grade, SessionTopicRequest request, AuthUser authUser) {
        // DB 검증 트랜잭션을 먼저 끝내 외부 Redis 호출 동안 DB 연결을 점유하지 않는다.
        sessionStarterGuard.requireStarterForGrade(sessionId, grade, authUser);

        String key = SessionRedisKeys.topics(sessionId);
        String field = String.valueOf(grade);
        String topic = request.topic().trim();

        if (topic.isEmpty()) {
            redis.opsForHash().delete(key, field);
            return;
        }

        redis.opsForHash().put(key, field, topic);
        redis.expire(key, TOPICS_TTL);
    }

    /** JSON 객체의 키가 "5", "6"처럼 직렬화되도록 문자열 키로 반환한다. */
    public Map<String, String> getTopics(Long sessionId) {
        Map<Object, Object> stored = redis.opsForHash()
                .entries(SessionRedisKeys.topics(sessionId));
        if (stored == null || stored.isEmpty()) {
            return Map.of();
        }

        Map<String, String> topics = new TreeMap<>();
        stored.forEach((grade, topic) ->
                topics.put(String.valueOf(grade), String.valueOf(topic)));
        return Map.copyOf(topics);
    }
}
