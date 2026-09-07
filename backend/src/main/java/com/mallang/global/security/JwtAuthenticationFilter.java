package com.mallang.global.security;

import com.mallang.user.entity.Role;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtTokenProvider jwtTokenProvider;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String token = resolveToken(request);
        if (token != null) {
            try {
                Claims claims = jwtTokenProvider.parse(token);
                // refresh 토큰으로는 API 호출 불가 — access 타입만 인증 처리
                if (JwtTokenProvider.TYPE_ACCESS.equals(claims.get(JwtTokenProvider.CLAIM_TYPE, String.class))) {
                    Role role = Role.valueOf(claims.get(JwtTokenProvider.CLAIM_ROLE, String.class));
                    String displayName = claims.get(JwtTokenProvider.CLAIM_NAME, String.class);
                    AuthUser authUser = new AuthUser(
                            Long.valueOf(claims.getSubject()), role, displayName);
                    UsernamePasswordAuthenticationToken authentication =
                            new UsernamePasswordAuthenticationToken(
                                    authUser, null,
                                    List.of(new SimpleGrantedAuthority("ROLE_" + role.name())));
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            } catch (JwtException | IllegalArgumentException e) {
                // 유효하지 않은 토큰 → 미인증 상태로 통과, 보호된 경로면 EntryPoint가 401 응답
                SecurityContextHolder.clearContext();
            }
        }
        filterChain.doFilter(request, response);
    }

    private String resolveToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            return header.substring(BEARER_PREFIX.length());
        }
        return null;
    }
}
