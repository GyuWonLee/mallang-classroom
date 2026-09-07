package com.mallang.session.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.global.security.StompPrincipals;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.Map;

/** 학생 손들기 토글. SEND: /pub/sessions/{sessionId}/hand → 수업 게시판에 방송 */
@Controller
@RequiredArgsConstructor
public class HandController {

    private final StringRedisTemplate redis;
    private final SimpMessagingTemplate messagingTemplate;

    @MessageMapping("/sessions/{sessionId}/hand")
    public void toggle(@DestinationVariable Long sessionId, Principal principal) {
        AuthUser user = StompPrincipals.authUser(principal);
        if (user.isTeacher()) {
            throw new AccessDeniedException("학생 전용 발행 주소입니다");
        }
        String key = "session:" + sessionId + ":hands";
        String uid = String.valueOf(user.id());
        // SADD 결과가 0이면 이미 들고 있던 것 → 내리기(토글)
        Long added = redis.opsForSet().add(key, uid);
        boolean raised = added != null && added > 0;
        if (!raised) {
            redis.opsForSet().remove(key, uid);
        }
        messagingTemplate.convertAndSend("/sub/sessions/" + sessionId,
                StompEnvelope.of(StompEventType.HAND_RAISED,
                        Map.of("studentId", user.id(), "raised", raised)));
    }
}
