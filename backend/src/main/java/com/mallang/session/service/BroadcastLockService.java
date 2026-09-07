package com.mallang.session.service;

import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.dto.SessionDtos.BroadcastLockRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;

/** 학생 방송 영역의 쉬는 시간 화면 잠금 상태를 관리한다. LiveKit 미디어 권한은 변경하지 않는다. */
@Service
@RequiredArgsConstructor
public class BroadcastLockService {

    private final SessionStarterGuard sessionStarterGuard;
    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redis;

    public void update(Long sessionId, BroadcastLockRequest request, AuthUser authUser) {
        // 별도 빈의 읽기 트랜잭션이 여기서 끝난 뒤 Redis를 호출한다.
        sessionStarterGuard.requireStarter(sessionId, authUser);

        boolean locked = Boolean.TRUE.equals(request.locked());
        String key = SessionRedisKeys.broadcastLock(sessionId);
        if (locked) {
            redis.opsForValue().set(key, "true");
        } else {
            redis.delete(key);
        }

        // 저장이 끝난 뒤에 방송한다 — 실패하면 예외가 올라가 방송이 나가지 않으므로
        // 화면만 잠기고 서버는 풀린 상태가 되는 어긋남이 생기지 않는다.
        messagingTemplate.convertAndSend("/sub/sessions/" + sessionId,
                StompEnvelope.of(StompEventType.BROADCAST_LOCK,
                        Map.of("locked", locked, "by", authUser.id())));
    }
}
