package com.mallang.realtime;

import com.mallang.chat.service.ChatRouterService;
import com.mallang.global.security.AuthUser;
import com.mallang.session.service.PresenceService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.Message;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.security.Principal;

/**
 * STOMP 연결/해제 이벤트 → 교사 온라인 프레즌스 갱신 (라우팅 규칙 2 "온라인 선생님"의 원천).
 * 학생의 온라인 여부는 라우팅에 쓰이지 않아 추적하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class WebSocketEventListener {

    private final PresenceService presenceService;
    private final ChatRouterService chatRouterService;

    @EventListener
    public void onConnected(SessionConnectedEvent event) {
        AuthUser user = resolve(event.getUser());
        if (user != null && user.isTeacher()) {
            presenceService.teacherOnline(user.id(), sessionIdOf(event.getMessage()));
            // 막 접속한 교사는 수업 중이 아님 → 대기 학생이 있으면 바로 연결
            chatRouterService.drainWaitingQueue(user.id());
        }
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        AuthUser user = resolve(event.getUser());
        if (user != null && user.isTeacher()) {
            presenceService.teacherOffline(user.id(), sessionIdOf(event.getMessage()));
        }
    }

    /**
     * STOMP 세션 id — 같은 선생님이 탭을 두 개 열면 서로 다르다.
     * 이 값이 있어야 "탭 하나 닫았는데 완전히 오프라인"을 피할 수 있다.
     */
    private String sessionIdOf(Message<byte[]> message) {
        return StompHeaderAccessor.wrap(message).getSessionId();
    }

    private AuthUser resolve(Principal principal) {
        if (principal instanceof UsernamePasswordAuthenticationToken auth
                && auth.getPrincipal() instanceof AuthUser authUser) {
            return authUser;
        }
        return null;
    }
}
