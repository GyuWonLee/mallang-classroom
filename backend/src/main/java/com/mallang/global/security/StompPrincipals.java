package com.mallang.global.security;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

import java.security.Principal;

/** STOMP 컨트롤러 공용 — 검문소(setUser)가 심어둔 Principal에서 AuthUser 추출 */
public final class StompPrincipals {

    private StompPrincipals() {
    }

    public static AuthUser authUser(Principal principal) {
        if (principal instanceof UsernamePasswordAuthenticationToken auth
                && auth.getPrincipal() instanceof AuthUser authUser) {
            return authUser;
        }
        throw new AccessDeniedException("인증 정보가 없습니다");
    }
}
