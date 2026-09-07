package com.mallang.assignment.ai;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 생성된 문항이 <b>학생이 보는 것만으로</b> 풀리는지 한 번 더 검증한다.
 *
 * <p>학생은 자료 전체를 보지 못하고, 문제마다 붙는 <b>원문 인용(sourceQuote) + 발문 + 보기</b>만 본다.
 * 그런데 생성 프롬프트가 "인용만으로 풀리게" 지시해도 모델이 늘 지키지는 않는다 — "이 글 전체에서…"
 * 처럼 자료를 봐야만 풀리는 문항이 섞인다. 그래서 생성 직후 각 문항이 인용+발문+보기만으로 정답이
 * 확정되는지 LLM 으로 한 번 판정하고, 결과를 초안에 실어 선생님 검수 화면이 걸러낼 수 있게 한다.</p>
 *
 * <p><b>베스트에포트</b>다 — GMS 가 없거나(키 없음) 호출/파싱이 실패하면 빈 결과를 돌려준다.
 * 그러면 초안엔 검증 플래그가 붙지 않고(=미검증), 생성 자체는 막지 않는다. 검증 실패가 생성을
 * 통째로 무너뜨리면 안 되기 때문이다.</p>
 */
@Slf4j
@Component
public class AssignmentVerifier {

    /** 문항 여러 개를 한 번에 판정한다 — 넉넉하되 상한은 둔다. */
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(30);

    private static final String SYSTEM_PROMPT = """
            당신은 초등학교 문제 검수 도구입니다.
            학생은 각 문제의 '인용문(원문)'과 '발문', '보기'만 봅니다 — 학습자료 전체는 보지 못합니다.
            각 문제가 그 셋(인용문+발문+보기)만으로 정답을 하나로 확정할 수 있는지 판정하세요.
            - 자료 전체를 봐야만 풀리거나("이 글에서…" 등), 인용문이 없어 발문만으로는 정답을 못 고르면 solvable=false.
            - 인용문·발문·보기만으로 정답이 분명하면 solvable=true.
            - reason 은 20자 이내의 짧은 한국어 사유.
            오직 JSON 배열만 출력합니다(코드펜스·설명 금지): [{"no": 정수, "solvable": true/false, "reason": "..."}]
            """;

    private final AiProperties properties;
    private final ObjectMapper objectMapper;
    /** GMS 설정이 없으면 null — 그 자체가 "검증할 수 없다"는 뜻이다(→ 빈 결과, 미검증). */
    private final RestClient rest;

    public AssignmentVerifier(AiProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.rest = GmsChatClients.orNull(properties, READ_TIMEOUT);
    }

    /** 문항 no → 검증 결과. 부를 수 없거나 실패하면 빈 맵(플래그를 붙이지 않는다). */
    public Map<Integer, Verdict> verify(List<GeneratedAssignment.Problem> problems) {
        if (rest == null || problems == null || problems.isEmpty()) {
            return Map.of();
        }
        try {
            String raw = rest.post()
                    .uri(properties.openai().chatPath())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "model", properties.openai().model(),
                            "max_completion_tokens", 800,
                            "messages", List.of(
                                    Map.of("role", "system", "content", SYSTEM_PROMPT),
                                    Map.of("role", "user", "content", userPayload(problems)))))
                    .retrieve()
                    .body(String.class);
            String content = objectMapper.readTree(raw)
                    .path("choices").path(0).path("message").path("content").asString("");
            return parseVerdicts(content);
        } catch (Exception e) {
            log.warn("문항 검증 LLM 호출 실패 — 검증 없이 진행한다", e);
            return Map.of();
        }
    }

    /** 학생이 실제로 보는 것(인용·발문·보기·정답)만 판정에 싣는다. */
    private String userPayload(List<GeneratedAssignment.Problem> problems) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (GeneratedAssignment.Problem p : problems) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("no", p.no());
            item.put("quote", p.sourceQuote() != null ? p.sourceQuote() : "");
            item.put("prompt", p.prompt());
            item.put("choices", p.choices());
            item.put("answer", p.answer());
            item.put("answerText", p.answerText());
            items.add(item);
        }
        try {
            return "다음 문제들을 판정하세요:\n" + objectMapper.writeValueAsString(items);
        } catch (Exception e) {
            // 직렬화가 깨질 일은 거의 없지만, 깨지면 검증을 건너뛰도록 빈 문자열을 준다.
            return "";
        }
    }

    /** 응답 본문(코드펜스가 붙어 올 수 있다)에서 JSON 배열을 뽑아 no→Verdict 로 만든다. */
    Map<Integer, Verdict> parseVerdicts(String content) {
        if (content == null || content.isBlank()) {
            return Map.of();
        }
        String json = stripFences(content);
        try {
            JsonNode array = objectMapper.readTree(json);
            if (!array.isArray()) {
                return Map.of();
            }
            Map<Integer, Verdict> out = new LinkedHashMap<>();
            for (JsonNode node : array) {
                if (!node.hasNonNull("no")) {
                    continue;
                }
                int no = node.get("no").asInt();
                boolean solvable = node.path("solvable").asBoolean(true);
                String reason = node.path("reason").asString("");
                out.put(no, new Verdict(solvable, reason));
            }
            return out;
        } catch (Exception e) {
            log.warn("문항 검증 응답 파싱 실패 — 검증 없이 진행한다", e);
            return Map.of();
        }
    }

    /** ```json … ``` 같은 코드펜스를 벗겨 순수 JSON만 남긴다. */
    private String stripFences(String text) {
        String trimmed = text.strip();
        if (trimmed.startsWith("```")) {
            int firstNewline = trimmed.indexOf('\n');
            if (firstNewline >= 0) {
                trimmed = trimmed.substring(firstNewline + 1);
            }
            if (trimmed.endsWith("```")) {
                trimmed = trimmed.substring(0, trimmed.length() - 3);
            }
        }
        return trimmed.strip();
    }

    /** 한 문항의 검증 결과 — 풀 수 있는지와 짧은 사유. */
    public record Verdict(boolean solvable, String note) {
    }
}
