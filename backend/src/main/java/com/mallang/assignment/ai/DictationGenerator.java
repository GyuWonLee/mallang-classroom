package com.mallang.assignment.ai;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 받아쓰기(DICTATION) 전용 생성기 — <b>자료 본문에서 문장을 뽑아</b> 만든다. 문항을 창작하지 않으므로
 * 일반 생성과 달리 LLM 이 "이 자료론 못 만든다"고 거절할 일이 없다(자료에 글만 있으면 항상 된다).
 *
 * <p>흐름은 세 단계다:</p>
 * <ol>
 *   <li><b>추출(규칙)</b> — 본문을 문장으로 쪼개 받아쓰기에 쓸 만한 후보를 고른다(길이·완결성·중복 정리).</li>
 *   <li><b>변형(LLM)</b> — GMS 가 있으면 후보 중 좋은 것을 골라 뜻은 유지하되 학년에 맞게 살짝 다듬는다.
 *       '생성'이 아니라 '선택+손질'이라 거절 위험이 낮다.</li>
 *   <li><b>폴백(규칙)</b> — LLM 이 없거나 실패하면 추출한 문장을 그대로 쓴다. 그래서 절대 실패하지 않는다.</li>
 * </ol>
 *
 * <p>받아쓰기는 학생에게 문장을 <b>소리로만</b> 주고(원문 인용을 화면에 띄우지 않음) 채점은 answerText 비교라,
 * 문장을 다듬어도 학생·채점 흐름은 그대로다.</p>
 */
@Slf4j
@Component
public class DictationGenerator {

    private static final Duration READ_TIMEOUT = Duration.ofSeconds(30);
    private static final String DEFAULT_TITLE = "받아쓰기 연습";

    private static final String SYSTEM_PROMPT = """
            당신은 초등학교 받아쓰기 문장을 다듬는 도구입니다.
            아래 <후보 문장> 중 받아쓰기에 좋은 것을 고르고, 뜻은 유지하되 해당 학년 학생이 받아쓸 수 있게
            짧고 자연스러운 한 문장으로 다듬으세요.
            - 후보에 없는 새로운 사실·인물·낱말을 지어내지 않습니다(있는 표현을 활용해 다듬기만 합니다).
            - 각 문장은 완결된 한 문장으로, 학년에 맞는 쉬운 낱말을 씁니다.
            - 요청한 개수만큼, 서로 다른 문장으로 만듭니다. 후보가 모자라면 있는 만큼만.
            오직 문자열 JSON 배열만 출력합니다(코드펜스·설명 금지): ["문장1", "문장2", ...]
            """;

    private final AiProperties properties;
    private final ObjectMapper objectMapper;
    /** GMS 설정이 없으면 null — 그러면 변형을 건너뛰고 추출한 문장을 그대로 쓴다. */
    private final RestClient rest;

    public DictationGenerator(AiProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.rest = GmsChatClients.orNull(properties, READ_TIMEOUT);
    }

    public GeneratedAssignment generate(GenerationCommand command) {
        List<Sentence> candidates = extractCandidates(command);
        if (candidates.isEmpty()) {
            // 글이 하나도 안 뽑히면(숫자·기호·이미지뿐) 만들 수 없다 — 러너가 친절 안내로 바꿔 준다.
            throw new GenerationRejectedException("학습자료가 비어 있습니다");
        }

        List<String> chosen = transform(candidates, command.grade(), command.count());
        if (chosen == null || chosen.isEmpty()) {
            chosen = pickHeuristically(candidates, command.count()); // 폴백 — 추출 문장 그대로
        }

        String defaultMaterialId = command.materials().get(0).materialId();
        int level = levelFor(command.grade());
        List<GeneratedAssignment.Problem> problems = new ArrayList<>();
        int no = 1;
        for (String sentence : chosen) {
            problems.add(new GeneratedAssignment.Problem(no++, sentence, null, null, sentence,
                    List.of("맞춤법"), level, defaultMaterialId, sentence));
        }
        return new GeneratedAssignment("ok", null, DEFAULT_TITLE, problems);
    }

    // --- 1) 추출 (규칙) ---

    private record Sentence(String materialId, String text) {
    }

    /** 본문을 문장으로 쪼개 받아쓰기에 쓸 만한 후보만 남긴다(길이·한글 포함·중복 정리). */
    private List<Sentence> extractCandidates(GenerationCommand command) {
        int min = minLen(command.grade());
        int max = maxLen(command.grade());
        List<Sentence> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (ResolvedMaterial m : command.materials()) {
            for (String unit : splitUnits(m.text())) {
                for (String candidate : withinLength(clean(unit), min, max)) {
                    if (candidate.matches(".*\\p{IsHangul}.*") && seen.add(candidate)) {
                        out.add(new Sentence(m.materialId(), candidate));
                    }
                }
            }
        }
        return out;
    }

    /** 줄바꿈과 문장부호(. ! ? 。 …)로 1차 분리. */
    private String[] splitUnits(String text) {
        return text == null ? new String[0] : text.split("(?<=[.!?。…])\\s*|\\R+");
    }

    /** 목록 기호·번호·군더더기 공백을 걷어낸다. 제목(#)은 빈 문자열로 만들어 뒤에서 걸러지게 한다. */
    private String clean(String unit) {
        String s = unit.strip();
        if (s.startsWith("#")) {
            return "";
        }
        s = s.replaceFirst("^[\\s\\d.)\\-•*·\\]]+", "");   // 앞의 목록 기호·번호
        s = s.replaceAll("\\s+", " ").strip();             // 내부 공백 정리
        return s;
    }

    /**
     * 길이에 맞으면 그대로, 너무 길면 쉼표 절로 쪼개 범위에 드는 조각만 취한다.
     * (긴 문장만 있는 자료도 받아쓰기 후보를 낼 수 있게 하는 '조금 변형'의 규칙 버전.)
     */
    private List<String> withinLength(String s, int min, int max) {
        if (s.isEmpty()) {
            return List.of();
        }
        if (s.length() <= max) {
            return s.length() >= min ? List.of(s) : List.of();
        }
        List<String> parts = new ArrayList<>();
        for (String part : s.split("\\s*[,·、]\\s*")) {
            String p = part.strip();
            if (p.length() >= min && p.length() <= max && p.matches(".*\\p{IsHangul}.*")) {
                parts.add(p);
            }
        }
        return parts;
    }

    // --- 2) 변형 (LLM) — 없거나 실패하면 null ---

    private List<String> transform(List<Sentence> candidates, int grade, int count) {
        if (rest == null) {
            return null;
        }
        try {
            StringBuilder user = new StringBuilder();
            user.append("학년: ").append(grade).append("학년\n요청 개수: ").append(count).append("개\n\n<후보 문장>\n");
            for (Sentence s : candidates) {
                user.append("- ").append(s.text()).append('\n');
            }
            String raw = rest.post()
                    .uri(properties.openai().chatPath())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "model", properties.openai().model(),
                            "max_completion_tokens", 800,
                            "messages", List.of(
                                    Map.of("role", "system", "content", SYSTEM_PROMPT),
                                    Map.of("role", "user", "content", user.toString()))))
                    .retrieve()
                    .body(String.class);
            String content = objectMapper.readTree(raw)
                    .path("choices").path(0).path("message").path("content").asString("");
            return parseSentences(content, count);
        } catch (Exception e) {
            log.warn("받아쓰기 문장 다듬기 실패 — 추출한 문장을 그대로 쓴다", e);
            return null;
        }
    }

    /** 응답(코드펜스 가능)에서 문자열 배열을 뽑아 최대 count개. 비면 null(→ 폴백). */
    List<String> parseSentences(String content, int count) {
        if (content == null || content.isBlank()) {
            return null;
        }
        String json = stripFences(content);
        try {
            JsonNode array = objectMapper.readTree(json);
            if (!array.isArray()) {
                return null;
            }
            List<String> out = new ArrayList<>();
            for (JsonNode node : array) {
                String s = node.asString("").strip();
                if (!s.isEmpty() && out.size() < count) {
                    out.add(s);
                }
            }
            return out.isEmpty() ? null : out;
        } catch (Exception e) {
            log.warn("받아쓰기 문장 응답 파싱 실패 — 추출한 문장을 그대로 쓴다", e);
            return null;
        }
    }

    private String stripFences(String text) {
        String t = text.strip();
        if (t.startsWith("```")) {
            int nl = t.indexOf('\n');
            if (nl >= 0) {
                t = t.substring(nl + 1);
            }
            if (t.endsWith("```")) {
                t = t.substring(0, t.length() - 3);
            }
        }
        return t.strip();
    }

    // --- 3) 폴백 (규칙) — 추출 문장을 자료 전체에 고르게 골라 최대 count개 ---

    private List<String> pickHeuristically(List<Sentence> candidates, int count) {
        List<String> out = new ArrayList<>();
        if (candidates.size() <= count) {
            for (Sentence s : candidates) {
                out.add(s.text());
            }
            return out;
        }
        // 자료 앞뒤로 치우치지 않게 균등 간격으로 고른다.
        double step = (double) candidates.size() / count;
        for (int i = 0; i < count; i++) {
            out.add(candidates.get((int) (i * step)).text());
        }
        return out;
    }

    // --- 길이·난이도 기준 (학년별) ---

    private int minLen(int grade) {
        return grade <= 2 ? 4 : grade <= 4 ? 6 : 8;
    }

    private int maxLen(int grade) {
        return grade <= 2 ? 16 : grade <= 4 ? 24 : 32;
    }

    private int levelFor(int grade) {
        return grade <= 2 ? 1 : grade <= 4 ? 2 : 3;
    }
}
