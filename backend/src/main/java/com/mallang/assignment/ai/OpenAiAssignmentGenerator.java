package com.mallang.assignment.ai;

import com.mallang.global.http.ExternalHttpClients;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;

import java.time.Duration;

/**
 * OpenAI Chat Completions 호환 게이트웨이용 생성기 (SSAFY GMS 등).
 * ai.provider=openai 일 때 활성화. 인증은 Authorization: Bearer, 엔드포인트는 {base-url}{chat-path}.
 *
 * <p>SSAFY GMS 예: base-url=https://gms.ssafy.io/gmsapi/api.openai.com, chat-path=/v1/chat/completions.
 * Claude 경로와 동일한 grounding 프롬프트를 쓰고, 동일한 초안 JSON을 만든다.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "ai.provider", havingValue = "openai")
public class OpenAiAssignmentGenerator implements AssignmentGenerator {

    private final RestClient rest;
    private final AiProperties properties;
    private final ObjectMapper objectMapper;

    public OpenAiAssignmentGenerator(AiProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        // 문항 여러 개를 한 번에 만든다 — 비동기 작업(genjob)이라 길게 주되 상한은 둔다.
        this.rest = RestClient.builder()
                .requestFactory(ExternalHttpClients.factory(Duration.ofSeconds(60)))
                .baseUrl(properties.openai().baseUrl())
                .defaultHeader("Authorization", "Bearer " + properties.openai().apiKey())
                .build();
    }

    @Override
    public GeneratedAssignment generate(GenerationCommand command) {
        Map<String, Object> body = Map.of(
                "model", properties.openai().model(),
                "max_completion_tokens", properties.openai().maxTokens(),
                "messages", List.of(
                        Map.of("role", "system", "content",
                                GenerationPrompt.system(command.subject(), command.expandFromScope())),
                        Map.of("role", "user", "content", GenerationPrompt.user(command))));

        String raw = rest.post()
                .uri(properties.openai().chatPath())
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String.class);

        return parse(extractContent(raw));
    }

    // OpenAI 응답: choices[0].message.content 에 모델이 생성한 본문(JSON 문자열)이 들어있다.
    private String extractContent(String raw) {
        JsonNode root;
        try {
            root = objectMapper.readTree(raw);
        } catch (JacksonException e) {
            throw new IllegalStateException("게이트웨이 응답을 해석할 수 없습니다: " + raw, e);
        }
        JsonNode choice = root.path("choices").path(0);
        // 응답이 max_tokens 에서 잘리면(finish_reason=length) 뒤가 끊긴 JSON 이라 파싱이 무조건
        // 실패한다. 원인을 분명히 잡아 '문항 수를 줄이라'는 안내로 바꾼다(불투명한 파싱 오류 방지).
        if ("length".equals(choice.path("finish_reason").asString(""))) {
            throw new GenerationRejectedException("생성 결과가 잘렸습니다");
        }
        JsonNode content = choice.path("message").path("content");
        if (content.isMissingNode() || content.isNull()) {
            throw new IllegalStateException("게이트웨이 응답에 choices[0].message.content 가 없습니다: " + raw);
        }
        return content.asString();
    }

    private GeneratedAssignment parse(String text) {
        String json = stripFences(text);
        GeneratedAssignment generated;
        try {
            generated = objectMapper.readValue(json, GeneratedAssignment.class);
        } catch (JacksonException e) {
            log.warn("LLM 응답 JSON 파싱 실패: {}", json, e);
            throw new IllegalStateException("AI 생성 결과를 해석할 수 없습니다.", e);
        }
        generated.validate(); // 거절(status=rejected)·빈 문항이면 예외
        return generated;
    }

    // 모델이 ```json ... ``` 코드펜스나 앞뒤 텍스트를 붙인 경우 방어적으로 JSON 객체만 추출.
    private String stripFences(String text) {
        String trimmed = text.trim();
        int start = trimmed.indexOf('{');
        int end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return trimmed.substring(start, end + 1);
        }
        return trimmed;
    }
}
