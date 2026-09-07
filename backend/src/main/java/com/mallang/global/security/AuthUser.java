package com.mallang.global.security;

import com.mallang.user.entity.Role;

import java.security.Principal;

/**
 * 인증된 사용자 정보. JWT 필터가 SecurityContext에 심고,
 * 컨트롤러에서 @AuthenticationPrincipal AuthUser 로 꺼내 쓴다.
 */
public record AuthUser(Long id, Role role, String displayName) implements Principal {

    /**
     * STOMP 인증은 기존처럼 id와 role만 사용한다.
     */
    public AuthUser(Long id, Role role) {
        this(id, role, null);
    }

    @Override
    public String getName() {
        return String.valueOf(id);
    }

    public boolean isTeacher() {
        return role == Role.TEACHER;
    }
}
