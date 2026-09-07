package com.mallang.support;

import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import tools.jackson.databind.ObjectMapper;

import java.util.List;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;

/**
 * REST API Positive 테스트 공통 뼈대.
 *
 * <p>하위 클래스는 {@code @WebMvcTest(XxxController.class)} 를 붙이고 서비스는
 * {@code @MockitoBean} 으로 대체한다. 인증 주체는 {@link #as(AuthUser)} 로 주입 —
 * 운영과 동일하게 {@code @AuthenticationPrincipal AuthUser} 로 풀린다.</p>
 */
@Tag("api")
@Import(ApiSecurityTestConfig.class)
public abstract class ApiTestSupport {

    /** 학급 관리자(선생님) — 대부분의 관리 API 호출자 */
    protected static final AuthUser TEACHER = new AuthUser(1L, Role.TEACHER, "이선생");

    /** 학생 — 본인 조회·발행 API 호출자 */
    protected static final AuthUser STUDENT = new AuthUser(11L, Role.STUDENT, "김학생");

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;

    /** 이 사용자로 로그인한 상태의 요청 */
    protected static RequestPostProcessor as(AuthUser user) {
        return authentication(new UsernamePasswordAuthenticationToken(
                user, null, List.of(new SimpleGrantedAuthority("ROLE_" + user.role().name()))));
    }

    protected String json(Object body) {
        return objectMapper.writeValueAsString(body);
    }
}
