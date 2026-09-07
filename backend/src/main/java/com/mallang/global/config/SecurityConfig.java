package com.mallang.global.config;

import com.mallang.global.security.JwtAuthenticationFilter;
import jakarta.servlet.DispatcherType;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.nio.charset.StandardCharsets;
import java.util.List;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // 처리되지 않은 예외는 Spring 이 /error 로 ERROR dispatch 하는데, 이걸 막으면
                        // 진짜 500 이 401 로 둔갑해 원인 추적이 어려워진다 (S15P11A407-122)
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers("/api/health", "/actuator/health").permitAll()
                        // Prometheus 스크레이프용. 외부 노출 경로가 아니다 —
                        // Nginx 에 /actuator 라우팅이 없어 컨테이너 네트워크에서만 닿는다.
                        .requestMatchers("/actuator/prometheus").permitAll()
                        // 인증 없이 접근 가능한 auth API만 명시 (me/logout은 인증 필요)
                        // 재설정은 비밀번호를 잊은 사람이 쓰는 길이라 인증을 요구할 수 없다.
                        // 열거·남용은 FixedWindowRateLimiter 와 "항상 같은 응답" 으로 막는다.
                        .requestMatchers("/api/auth/teachers/signup", "/api/auth/login",
                                "/api/auth/refresh", "/api/auth/password-reset/request",
                                "/api/auth/password-reset/confirm").permitAll()
                        .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll()
                        .requestMatchers("/ws/**").permitAll() // STOMP에서 헤더를 자유롭게 넣을 수 있게.
                        // LiveKit 서버가 호출 (브라우저 아님). 서명 검증은 컨트롤러에서 (LiveKitWebhookVerifier)
                        .requestMatchers("/api/webhooks/livekit").permitAll()
                        // 초대 수락은 미가입 학생의 유일한 가입 경로 — 코드 자체가 인증 수단.
                        // 선생님 초대(TEACHER)는 서비스에서 로그인 여부를 다시 검사한다 (명세 §3)
                        .requestMatchers(HttpMethod.POST, "/api/invites/*/accept").permitAll()
                        // 미리보기도 같은 이유로 공개 — 가입 전에 만료·학급명을 확인하는 경로다.
                        // 인증으로 막을 수 없으므로 코드 열거는 InviteCodeRateLimiter 가 막는다.
                        .requestMatchers(HttpMethod.GET, "/api/invites/*").permitAll()
                        .anyRequest().authenticated())
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                // 미인증 접근 → 401을 RFC 9457(Problem Details) 형식으로
                .exceptionHandling(ex -> ex.authenticationEntryPoint((request, response, e) -> {
                    response.setStatus(401);
                    response.setContentType("application/problem+json");
                    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
                    response.getWriter().write("""
                            {"type":"https://mallang.app/errors/unauthorized",
                             "title":"인증이 필요합니다",
                             "status":401,
                             "instance":"%s"}""".formatted(request.getRequestURI()));
                }));
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(
                "http://localhost:5173",
                "https://classroom.example.com"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
