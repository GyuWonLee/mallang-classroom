package com.mallang.assignment.ai;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 받아쓰기 생성기 — LLM 없이(추출·폴백)도 자료 문장으로 문항을 만든다는 것과, 응답 파싱을 고정한다.
 * (LLM 변형 자체는 GMS 라이브 테스트 영역이고, 여기서는 규칙·파싱만 본다.)
 */
class DictationGeneratorTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    // provider=stub → GMS 없음 → 변형 건너뛰고 추출 문장을 그대로 쓴다(폴백).
    private final DictationGenerator generator =
            new DictationGenerator(new AiProperties("stub", null, null, null, null), objectMapper);

    private GenerationCommand command(String text, int count) {
        return new GenerationCommand(Subject.KOREAN, AssignmentType.DICTATION, 2, count,
                List.of(new ResolvedMaterial("builtin-korean-g2", "국어 2학년", text)));
    }

    @Test
    void buildsDictationProblemsFromMaterialSentencesWithoutLlm() {
        GeneratedAssignment result = generator.generate(command("학교에 갔다\n동생이 웃었다\n비가 내렸다", 3));

        assertThat(result.status()).isEqualTo("ok");
        assertThat(result.problems()).hasSize(3);
        GeneratedAssignment.Problem first = result.problems().get(0);
        // 받아쓰기: 읽어줄 문장 = 정답(answerText), 보기 없음
        assertThat(first.choices()).isNull();
        assertThat(first.answerText()).isEqualTo(first.prompt());
        assertThat(result.problems()).allSatisfy(p ->
                assertThat(p.answerText()).isIn("학교에 갔다", "동생이 웃었다", "비가 내렸다"));
    }

    @Test
    void skipsHeadersAndTooShortLinesAndDeduplicates() {
        // '# 제목'(헤더)·'네.'(너무 짧음)은 빠지고, 중복은 한 번만
        GeneratedAssignment result = generator.generate(
                command("# 2학년 국어\n네.\n학교에 갔다\n학교에 갔다\n동생이 웃었다", 5));

        assertThat(result.problems()).hasSize(2); // 학교에 갔다 · 동생이 웃었다
        assertThat(result.problems()).extracting(GeneratedAssignment.Problem::answerText)
                .containsExactlyInAnyOrder("학교에 갔다", "동생이 웃었다");
    }

    @Test
    void rejectsWhenNoUsableSentence() {
        // 숫자·기호뿐이라 뽑을 문장이 없으면 거절(러너가 친절 안내로 바꾼다)
        assertThatThrownBy(() -> generator.generate(command("12 34 56\n---\n###", 3)))
                .isInstanceOf(GenerationRejectedException.class);
    }

    @Test
    void parseSentencesStripsFencesAndCapsCount() {
        List<String> parsed = generator.parseSentences(
                "```json\n[\"학교에 갔다\", \"동생이 웃었다\", \"비가 내렸다\"]\n```", 2);

        assertThat(parsed).containsExactly("학교에 갔다", "동생이 웃었다"); // count=2 로 잘림
    }

    @Test
    void parseSentencesReturnsNullOnGarbage() {
        assertThat(generator.parseSentences("이건 JSON 아님", 3)).isNull();
        assertThat(generator.parseSentences("", 3)).isNull();
    }
}
