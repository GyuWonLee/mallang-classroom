package com.mallang.global.security;

import com.mallang.session.service.SubscriptionPermissionService;
import com.mallang.user.entity.Role;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * STOMP 검문소.
 * CONNECT: JWT 검증 후 세션에 사용자 심기
 * SUBSCRIBE: 명세 destination 3종만 허용(화이트리스트) + 자기 세션/팀 검증
 */
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final String BEARER_PREFIX = "Bearer ";
    private static final Pattern SESSION_TOPIC = Pattern.compile("^/sub/sessions/(\\d+)$");
    private static final Pattern TEAM_TOPIC = Pattern.compile("^/sub/sessions/(\\d+)/teams/(\\d+)$");
    private static final String PERSONAL_TOPIC = "/user/sub/notifications";

    private final JwtTokenProvider jwtTokenProvider;
    private final SubscriptionPermissionService subscriptionPermissionService;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message; // 하트비트 등은 통과
        }
        switch (accessor.getCommand()) {
            case CONNECT -> authenticate(accessor);
            case SUBSCRIBE -> checkSubscribePermission(accessor);
            default -> { }
        }
        return message;
    }

    private void authenticate(StompHeaderAccessor accessor) {
        String header = accessor.getFirstNativeHeader("Authorization");
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            throw new AccessDeniedException("인증 토큰이 없습니다");
        }
        try {
            Claims claims = jwtTokenProvider.parse(header.substring(BEARER_PREFIX.length()));
            if (!JwtTokenProvider.TYPE_ACCESS.equals(
                    claims.get(JwtTokenProvider.CLAIM_TYPE, String.class))) {
                throw new AccessDeniedException("access 토큰이 아닙니다");
            }
            Role role = Role.valueOf(claims.get(JwtTokenProvider.CLAIM_ROLE, String.class));
            AuthUser authUser = new AuthUser(Long.valueOf(claims.getSubject()), role);
            accessor.setUser(new UsernamePasswordAuthenticationToken(
                    authUser, null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + role.name()))));
        } catch (JwtException | IllegalArgumentException e) {
            throw new AccessDeniedException("유효하지 않은 토큰입니다");
        }
    }

    private void checkSubscribePermission(StompHeaderAccessor accessor) {
        String destination = accessor.getDestination();
        AuthUser user = resolveUser(accessor);
        if (destination == null || user == null) {
            throw new AccessDeniedException("잘못된 구독 요청입니다");
        }
        if (PERSONAL_TOPIC.equals(destination)) {
            return; // 개인 사물함 — 브로커가 본인에게만 배달
        }
        Matcher session = SESSION_TOPIC.matcher(destination);
        if (session.matches()) {
            subscriptionPermissionService.checkSessionAccess(Long.valueOf(session.group(1)), user);
            return;
        }
        Matcher team = TEAM_TOPIC.matcher(destination);
        if (team.matches()) {
            subscriptionPermissionService.checkTeamAccess(
                    Long.valueOf(team.group(1)), Long.valueOf(team.group(2)), user);
            return;
        }
        throw new AccessDeniedException("허용되지 않은 destination: " + destination);
    }

    private AuthUser resolveUser(StompHeaderAccessor accessor) {
        if (accessor.getUser() instanceof UsernamePasswordAuthenticationToken auth
                && auth.getPrincipal() instanceof AuthUser authUser) {
            return authUser;
        }
        return null;
    }
}