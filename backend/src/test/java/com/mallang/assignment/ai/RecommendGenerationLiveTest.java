package com.mallang.assignment.ai;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.material.MaterialSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.List;

/**
 * 이슈 76 실전 확인 — "약점 개념(focusTags) + 고정 난이도(level)"를 실제 GMS로 태워
 * 생성된 문항이 (1) 그 개념 위주인지 (2) 지정 난이도로 나오는지 (3) 학년 자료 안에서 나오는지 눈으로 본다.
 * AI_OPENAI_API_KEY(=GMS 키)가 있을 때만 실행, 없으면 자동 skip. DB/Redis 불필요.
 *
 * 실행 (PowerShell):
 *   $env:AI_OPENAI_API_KEY = Read-Host "GMS 키"
 *   .\gradlew.bat cleanTest test --tests "*RecommendGenerationLiveTest" --info
 *
 * 바꿔보고 싶으면 아래 FOCUS_TAG / TARGET_LEVEL / GRADE 상수만 수정.
 */
@EnabledIfEnvironmentVariable(named = "AI_OPENAI_API_KEY", matches = ".+")
class RecommendGenerationLiveTest {

    private static final int GRADE = 2;                 // 학생 학년 → builtin-korean-g{GRADE} 자료로 grounding
    private static final String FOCUS_TAG = "받침규칙";   // 약점 개념 (이 개념 위주로 나오는지 확인)
    private static final int TARGET_LEVEL = 2;          // 목표 난이도 1=기초·2=기본·3=심화 (같은 난이도로 나오는지 확인)
    private static final int COUNT = 5;

    @Test
    void generatesWeaknessFocusedProblemsAtTargetLevel() {
        String apiKey = System.getenv("AI_OPENAI_API_KEY");
        String baseUrl = System.getenv().getOrDefault(
                "AI_OPENAI_BASE_URL", "https://gms.ssafy.io/gmsapi/api.openai.com");
        String chatPath = System.getenv().getOrDefault("AI_OPENAI_CHAT_PATH", "/v1/chat/completions");
        String model = System.getenv().getOrDefault("AI_OPENAI_MODEL", "gpt-4o");

        ObjectMapper mapper = JsonMapper.builder().build();
        AiProperties props = new AiProperties(
                "openai", null,
                new AiProperties.OpenAi(apiKey, baseUrl, model, 4000, chatPath),
                null,
                Duration.ofHours(24));

        OpenAiAssignmentGenerator generator = new OpenAiAssignmentGenerator(props, mapper);
        MaterialSource materialSource = new MaterialSource(null, props); // 내장 자료만 쓰므로 repo 불필요

        // 76 핵심: focusTags(약점) + level(추천 난이도)까지 태운 7-arg 커맨드
        GenerationCommand command = new GenerationCommand(
                Subject.KOREAN, AssignmentType.MULTIPLE_CHOICE, GRADE, COUNT,
                materialSource.resolve(1L, List.of("builtin-korean-g" + GRADE)),
                List.of(FOCUS_TAG), TARGET_LEVEL);

        GeneratedAssignment result = generator.generate(command);
        result.validate();

        System.out.printf("%n===== 맞춤 생성 결과 (model=%s) =====%n", model);
        System.out.printf("요청: %d학년 · 약점개념='%s' · 목표난이도=%d · %d문항%n",
                GRADE, FOCUS_TAG, TARGET_LEVEL, COUNT);
        System.out.println("제목: " + result.title());

        int onFocus = 0;
        int onLevel = 0;
        for (GeneratedAssignment.Problem p : result.problems()) {
            boolean focusHit = p.conceptTags() != null && p.conceptTags().contains(FOCUS_TAG);
            boolean levelHit = p.level() != null && p.level() == TARGET_LEVEL;
            if (focusHit) {
                onFocus++;
            }
            if (levelHit) {
                onLevel++;
            }
            System.out.printf("%n[%d] %s%n", p.no(), p.prompt());
            if (p.choices() != null) {
                for (int i = 0; i < p.choices().size(); i++) {
                    System.out.printf("    %s%d) %s%n",
                            (p.answer() != null && p.answer() == i) ? "✔ " : "  ", i, p.choices().get(i));
                }
            }
            System.out.printf("    개념=%s %s | 난이도=%s %s%n",
                    p.conceptTags(), focusHit ? "(약점 적중)" : "",
                    p.level(), levelHit ? "(목표 일치)" : "");
            System.out.println("    근거 인용(자료 원문): \"" + p.sourceQuote() + "\"");
        }

        System.out.printf("%n--- 요약 ---%n");
        System.out.printf("약점개념 '%s' 포함: %d/%d 문항%n", FOCUS_TAG, onFocus, result.problems().size());
        System.out.printf("목표난이도 %d 일치: %d/%d 문항%n", TARGET_LEVEL, onLevel, result.problems().size());
        System.out.println(">> 근거 인용이 전부 자료 원문이면 '학년 자료 범위 안'이라는 뜻입니다.");
        System.out.println("================================\n");
    }
}
