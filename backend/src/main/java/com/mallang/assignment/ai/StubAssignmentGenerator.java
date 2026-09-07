package com.mallang.assignment.ai;

import com.mallang.assignment.entity.AssignmentType;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 로컬/개발용 생성기 — LLM 없이 자료 텍스트에서 문장을 뽑아 샘플 초안을 만든다.
 * 검수·발행 플로우를 API 키 없이 그대로 테스트하기 위한 것. 기본 provider.
 */
@Component
@ConditionalOnProperty(name = "ai.provider", havingValue = "stub", matchIfMissing = true)
public class StubAssignmentGenerator implements AssignmentGenerator {

    private record Quote(String materialId, String text) {
    }

    @Override
    public GeneratedAssignment generate(GenerationCommand command) {
        List<Quote> quotes = collectQuotes(command);
        List<GeneratedAssignment.Problem> problems = new ArrayList<>();
        for (int i = 0; i < command.count(); i++) {
            Quote q = quotes.get(i % quotes.size());
            problems.add(toProblem(i + 1, q, command.type()));
        }
        String title = "[샘플] %d학년 %s %s".formatted(
                command.grade(), command.subject(), command.type());
        return new GeneratedAssignment("ok", null, title, problems);
    }

    private List<Quote> collectQuotes(GenerationCommand command) {
        List<Quote> quotes = new ArrayList<>();
        for (ResolvedMaterial m : command.materials()) {
            for (String line : m.text().split("\\R")) {
                String t = line.trim();
                if (!t.isEmpty() && !t.startsWith("#")) {
                    quotes.add(new Quote(m.materialId(), t));
                }
            }
        }
        if (quotes.isEmpty()) {
            quotes.add(new Quote(command.materials().get(0).materialId(), "학교에 갔다"));
        }
        return quotes;
    }

    private GeneratedAssignment.Problem toProblem(int no, Quote q, AssignmentType type) {
        int level = (no % 3) + 1;
        List<String> tags = List.of("맞춤법");
        return switch (type) {
            case DICTATION -> new GeneratedAssignment.Problem(
                    no, "다음 문장을 듣고 받아쓰세요.", null, null, q.text(),
                    tags, level, q.materialId(), q.text());
            case OX, QUIZ_GAME -> new GeneratedAssignment.Problem(
                    no, "'%s'는 학습 자료에 나온 표현이다.".formatted(q.text()),
                    Arrays.asList("O", "X"), 0, null,
                    tags, level, q.materialId(), q.text());
            default -> new GeneratedAssignment.Problem(
                    no, "다음 중 학습 자료에 나온 표현을 고르세요.",
                    Arrays.asList(q.text(), q.text() + "?", "보기 없음"), 0, null,
                    tags, level, q.materialId(), q.text());
        };
    }
}
