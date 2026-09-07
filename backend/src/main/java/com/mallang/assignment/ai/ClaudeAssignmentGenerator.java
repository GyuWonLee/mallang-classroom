package com.mallang.assignment.ai;

import com.anthropic.client.AnthropicClient;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.TextBlock;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.stream.Collectors;

/**
 * Anthropic Claude 기반 생성기. ai.provider=anthropic 일 때만 활성화 (ANTHROPIC_API_KEY 필요).
 * 배경 작업(genjob)에서 호출되므로 동기 호출 + SDK 기본 타임아웃(최대 10분)에 의존한다.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "ai.provider", havingValue = "anthropic")
@RequiredArgsConstructor
public class ClaudeAssignmentGenerator implements AssignmentGenerator {

    private final AnthropicClient client;
    private final AiProperties properties;
    private final ObjectMapper objectMapper;

    @Override
    public GeneratedAssignment generate(GenerationCommand command) {
        MessageCreateParams params = MessageCreateParams.builder()
                .model(properties.anthropic().model())
                .maxTokens(properties.anthropic().maxTokens())
                .system(GenerationPrompt.system(command.subject(), command.expandFromScope()))
                .addUserMessage(GenerationPrompt.user(command))
                .build();

        Message response = client.messages().create(params);
        String text = response.content().stream()
                .flatMap(block -> block.text().stream())
                .map(TextBlock::text)
                .collect(Collectors.joining());

        return parse(text);
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

    // 모델이 실수로 ```json ... ``` 코드펜스나 앞뒤 텍스트를 붙인 경우를 방어적으로 잘라낸다.
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
