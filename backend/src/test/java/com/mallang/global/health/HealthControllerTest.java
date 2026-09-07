package com.mallang.global.health;

import com.mallang.support.ApiTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** GET /api/health — 인증 없이 열려 있는 헬스체크 */
@WebMvcTest(HealthController.class)
class HealthControllerTest extends ApiTestSupport {

    @Test
    @DisplayName("헬스체크는 인증 없이 200과 서비스 이름을 준다")
    void health() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.service").value("mallang"));
    }
}
