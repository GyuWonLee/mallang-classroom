package com.mallang.global.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI openAPI() {
        String jwt = "bearerAuth";
        return new OpenAPI()
                .info(new Info()
                        .title("mallang API")
                        .description("초등 저학년 실시간 원격 수업 + AI 학습 보조 플랫폼")
                        .version("v0.1"))
                // Swagger UI 우측 상단 Authorize 버튼에 JWT 입력 가능하게 설정
                .addSecurityItem(new SecurityRequirement().addList(jwt))
                .components(new Components().addSecuritySchemes(jwt,
                        new SecurityScheme()
                                .name(jwt)
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")));
    }
}
