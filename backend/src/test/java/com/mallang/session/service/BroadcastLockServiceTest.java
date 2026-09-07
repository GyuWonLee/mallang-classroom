package com.mallang.session.service;

import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.dto.SessionDtos.BroadcastLockRequest;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@SuppressWarnings("unchecked")
class BroadcastLockServiceTest {

    private static final String KEY = "session:10:broadcast-lock";

    @Mock SessionStarterGuard sessionStarterGuard;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock StringRedisTemplate redis;
    @Mock ValueOperations<String, String> valueOperations;

    private BroadcastLockService service;

    @BeforeEach
    void setUp() {
        service = new BroadcastLockService(sessionStarterGuard, messagingTemplate, redis);
    }

    @Test
    void locksStudentBroadcastArea() {
        when(redis.opsForValue()).thenReturn(valueOperations);

        service.update(10L, new BroadcastLockRequest(true), teacher());

        verify(sessionStarterGuard).requireStarter(10L, teacher());
        verify(valueOperations).set(KEY, "true");
        verify(redis, never()).delete(KEY);
    }

    @Test
    void unlocksStudentBroadcastArea() {
        service.update(10L, new BroadcastLockRequest(false), teacher());

        verify(sessionStarterGuard).requireStarter(10L, teacher());
        verify(redis).delete(KEY);
        verify(redis, never()).opsForValue();
    }

    /** 다른 참가자가 잠금 상태를 알아야 하므로 저장 뒤 방송까지 나가야 한다 */
    @Test
    void broadcastsLockStateAfterSaving() {
        when(redis.opsForValue()).thenReturn(valueOperations);

        service.update(10L, new BroadcastLockRequest(true), teacher());

        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        InOrder order = inOrder(valueOperations, messagingTemplate);
        order.verify(valueOperations).set(KEY, "true");
        order.verify(messagingTemplate).convertAndSend(eq("/sub/sessions/10"), captor.capture());
        StompEnvelope envelope = (StompEnvelope) captor.getValue();
        assertThat(envelope.type()).isEqualTo(StompEventType.BROADCAST_LOCK);
        assertThat((Map<String, Object>) envelope.payload())
                .containsEntry("locked", true)
                .containsEntry("by", 1L);
    }

    @Test
    void broadcastsUnlockState() {
        service.update(10L, new BroadcastLockRequest(false), teacher());

        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSend(eq("/sub/sessions/10"), captor.capture());
        StompEnvelope envelope = (StompEnvelope) captor.getValue();
        assertThat((Map<String, Object>) envelope.payload()).containsEntry("locked", false);
    }

    private AuthUser teacher() {
        return new AuthUser(1L, Role.TEACHER, "이선생");
    }
}
