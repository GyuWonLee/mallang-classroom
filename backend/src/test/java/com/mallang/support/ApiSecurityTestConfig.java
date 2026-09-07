package com.mallang.support;

import com.mallang.global.security.JwtTokenProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

import java.time.Duration;

/**
 * 컨트롤러 슬라이스(@WebMvcTest)용 보안 배선.
 *
 * <p>운영 SecurityConfig 는 @Configuration 이라 슬라이스에 올라오지 않는다. 대신 여기서
 * "인가는 전부 허용 + CSRF 끔" 체인을 깔아, 각 테스트가 인증 주체를 직접 주입해
 * 컨트롤러의 계약(상태코드·본문·헤더)만 검증하도록 한다. 인가 규칙 자체는 서비스 계층
 * 테스트(권한 예외)와 운영 SecurityConfig 의 몫.</p>
 */
@TestConfiguration
public class ApiSecurityTestConfig {

    @Bean
    SecurityFilterChain testSecurityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }

    /**
     * JwtAuthenticationFilter 는 Filter 빈이라 @WebMvcTest 슬라이스에 자동으로 딸려온다.
     * 그 의존성을 채워주지 않으면 컨텍스트가 뜨지 않는다 (토큰 없는 요청은 그냥 통과시킨다).
     */
    @Bean
    JwtTokenProvider jwtTokenProvider(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.access-token-validity}") Duration accessTokenValidity,
            @Value("${jwt.refresh-token-validity}") Duration refreshTokenValidity) {
        return new JwtTokenProvider(secret, accessTokenValidity, refreshTokenValidity);
    }
}
