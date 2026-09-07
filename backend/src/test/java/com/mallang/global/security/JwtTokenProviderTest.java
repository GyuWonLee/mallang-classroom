package com.mallang.global.security;

import com.mallang.user.entity.Role;
import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class JwtTokenProviderTest {

    private static final String SECRET =
            "jwt-test-secret-must-be-at-least-32-bytes-long";

    @Test
    void accessTokenContainsDisplayName() {
        JwtTokenProvider provider = new JwtTokenProvider(
                SECRET, Duration.ofMinutes(30), Duration.ofDays(14));

        String token = provider.createAccessToken(7L, Role.STUDENT, "Student Kim");
        Claims claims = provider.parse(token);

        assertThat(claims.getSubject()).isEqualTo("7");
        assertThat(claims.get(JwtTokenProvider.CLAIM_ROLE, String.class))
                .isEqualTo(Role.STUDENT.name());
        assertThat(claims.get(JwtTokenProvider.CLAIM_NAME, String.class))
                .isEqualTo("Student Kim");
        assertThat(claims.get(JwtTokenProvider.CLAIM_TYPE, String.class))
                .isEqualTo(JwtTokenProvider.TYPE_ACCESS);
    }

    @Test
    void refreshTokenDoesNotContainDisplayName() {
        JwtTokenProvider provider = new JwtTokenProvider(
                SECRET, Duration.ofMinutes(30), Duration.ofDays(14));

        Claims claims = provider.parse(provider.createRefreshToken(7L, Role.STUDENT));

        assertThat(claims).doesNotContainKey(JwtTokenProvider.CLAIM_NAME);
    }
}
