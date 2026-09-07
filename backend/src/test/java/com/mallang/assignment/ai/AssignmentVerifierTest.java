package com.mallang.assignment.ai;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 문항 검증기 — 응답 파싱과 "부를 수 없으면 조용히 넘어간다"는 계약을 고정한다.
 * (LLM 호출 자체는 GMS 라이브 테스트에서 확인하고, 여기서는 순수 로직만 본다.)
 */
class AssignmentVerifierTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private final AssignmentVerifier verifier =
            new AssignmentVerifier(new AiProperties("stub", null, null, null, null), objectMapper);

    @Test
    void parsesSolvableFlagsByProblemNumber() {
        String content = """
                [{"no":1,"solvable":true,"reason":"인용으로 풀림"},
                 {"no":2,"solvable":false,"reason":"자료 전체 필요"}]
                """;

        Map<Integer, AssignmentVerifier.Verdict> verdicts = verifier.parseVerdicts(content);

        assertThat(verdicts.get(1).solvable()).isTrue();
        assertThat(verdicts.get(2).solvable()).isFalse();
        assertThat(verdicts.get(2).note()).isEqualTo("자료 전체 필요");
    }

    @Test
    void stripsCodeFencesBeforeParsing() {
        String content = "```json\n[{\"no\":1,\"solvable\":false,\"reason\":\"발문만으로 불가\"}]\n```";

        Map<Integer, AssignmentVerifier.Verdict> verdicts = verifier.parseVerdicts(content);

        assertThat(verdicts).containsKey(1);
        assertThat(verdicts.get(1).solvable()).isFalse();
    }

    @Test
    void returnsEmptyWhenResponseIsBlankOrNotJson() {
        assertThat(verifier.parseVerdicts("")).isEmpty();
        assertThat(verifier.parseVerdicts("이건 JSON이 아니에요")).isEmpty();
    }

    @Test
    void skipsVerificationWhenGmsIsNotConfigured() {
        // provider=stub → GMS 클라이언트 없음 → 검증할 수 없으니 빈 결과(플래그 미부착)
        List<GeneratedAssignment.Problem> problems = List.of(new GeneratedAssignment.Problem(
                1, "받침이 무엇인가요?", List.of("자음", "모음"), 0, null,
                List.of("받침규칙"), 2, "builtin-korean-g2", "받침은 글자 아래 자음이에요"));

        assertThat(verifier.verify(problems)).isEmpty();
    }
}
