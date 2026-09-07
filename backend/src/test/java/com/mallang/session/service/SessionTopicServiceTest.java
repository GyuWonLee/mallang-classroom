package com.mallang.session.service;

import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.SessionDtos.SessionTopicRequest;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SessionTopicServiceTest {

    private static final String KEY = "session:10:topics";

    @Mock SessionStarterGuard sessionStarterGuard;
    @Mock StringRedisTemplate redis;
    @Mock HashOperations<String, Object, Object> hashOperations;

    private SessionTopicService service;

    @BeforeEach
    void setUp() {
        service = new SessionTopicService(sessionStarterGuard, redis);
    }

    @Test
    void savesTrimmedTopicByGradeAndSetsTtl() {
        when(redis.opsForHash()).thenReturn(hashOperations);

        service.update(10L, 5, new SessionTopicRequest("  분수의 덧셈  "), teacher());

        verify(sessionStarterGuard).requireStarterForGrade(10L, 5, teacher());
        verify(hashOperations).put(KEY, "5", "분수의 덧셈");
        verify(redis).expire(KEY, SessionTopicService.TOPICS_TTL);
    }

    @Test
    void blankTopicDeletesOnlyRequestedGrade() {
        when(redis.opsForHash()).thenReturn(hashOperations);

        service.update(10L, 6, new SessionTopicRequest("   "), teacher());

        verify(hashOperations).delete(KEY, "6");
        verify(hashOperations, never()).put(KEY, "6", "");
        verify(redis, never()).expire(KEY, SessionTopicService.TOPICS_TTL);
    }

    @Test
    void readsTopicsAsStringKeyedMap() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.entries(KEY)).thenReturn(Map.of(
                "6", "소수의 나눗셈",
                "5", "분수의 덧셈"));

        Map<String, String> topics = service.getTopics(10L);

        assertThat(topics).containsExactlyInAnyOrderEntriesOf(Map.of(
                "5", "분수의 덧셈",
                "6", "소수의 나눗셈"));
    }

    @Test
    void returnsEmptyMapWhenNoTopicExists() {
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.entries(KEY)).thenReturn(Map.of());

        assertThat(service.getTopics(10L)).isEmpty();
    }

    private AuthUser teacher() {
        return new AuthUser(1L, Role.TEACHER, "이선생");
    }
}
