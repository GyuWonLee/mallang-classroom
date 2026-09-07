package com.mallang.global.security;

import com.mallang.user.entity.Role;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

@Component
public class JwtTokenProvider {

    public static final String CLAIM_ROLE = "role";
    public static final String CLAIM_NAME = "name";
    public static final String CLAIM_TYPE = "typ";
    public static final String TYPE_ACCESS = "access";
    public static final String TYPE_REFRESH = "refresh";

    private final SecretKey key;
    private final Duration accessTokenValidity;
    @Getter
    private final Duration refreshTokenValidity;

    public JwtTokenProvider(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.access-token-validity}") Duration accessTokenValidity,
            @Value("${jwt.refresh-token-validity}") Duration refreshTokenValidity) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTokenValidity = accessTokenValidity;
        this.refreshTokenValidity = refreshTokenValidity;
    }

    public String createAccessToken(Long userId, Role role, String displayName) {
        return createToken(userId, TYPE_ACCESS, role, displayName, accessTokenValidity);
    }

    public String createRefreshToken(Long userId, Role role) {
        return createToken(userId, TYPE_REFRESH, role, null, refreshTokenValidity);
    }

    private String createToken(Long userId, String type, Role role, String displayName,
                               Duration validity) {
        Instant now = Instant.now();
        var builder = Jwts.builder()
                .subject(String.valueOf(userId))
                .claim(CLAIM_TYPE, type)
                .claim(CLAIM_ROLE, role.name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(validity)));
        if (displayName != null) {
            builder.claim(CLAIM_NAME, displayName);
        }
        return builder.signWith(key).compact();
    }

    /**
     * 서명·만료 검증 후 클레임 반환. 유효하지 않으면 JwtException.
     */
    public Claims parse(String token) throws JwtException {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
