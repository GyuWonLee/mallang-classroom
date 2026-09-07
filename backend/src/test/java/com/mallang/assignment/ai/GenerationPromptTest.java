package com.mallang.assignment.ai;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * LLM 생성 프롬프트.
 *
 * <p>문항 품질이 이 문자열에서 갈린다. 특히 <b>grounding</b> — 학습자료 밖의 어휘를 쓰지
 * 말라는 지시가 빠지면 2학년에게 모르는 낱말이 섞인 받아쓰기가 나간다. 프롬프트는 조용히
 * 망가지는 종류라(응답은 그럴듯하게 온다) 계약을 테스트로 붙들어 둔다.</p>
 */
class GenerationPromptTest {

    private final ResolvedMaterial material =
            new ResolvedMaterial("m-1", "2학년 1학기 국어", "학교에 갔다. 꽃이 피었다.");

    @Test
    void systemPromptCarriesTheConceptTagVocabulary() {
        String korean = GenerationPrompt.system(Subject.KOREAN);

        // 태그가 자유 문자열이 되면 리포트의 개념별 집계가 흩어진다
        assertThat(korean).contains("맞춤법");
        assertThat(korean).doesNotContain("{{TAGS}}");
    }

    @Test
    void koreanUsesFixedDictionaryWhileOtherSubjectsAreMaterialBased() {
        String korean = GenerationPrompt.system(Subject.KOREAN);
        String math = GenerationPrompt.system(Subject.MATH);

        // 국어는 고정 태그 사전을 강제하고(목록에서만), 수학 등은 자료에서 개념을 뽑는다
        assertThat(korean).contains("목록에서만");
        assertThat(korean).contains("맞춤법");
        assertThat(math).doesNotContain("목록에서만");
        assertThat(math).contains("자료 안에서 뽑아");
        assertThat(korean).isNotEqualTo(math);
        assertThat(math).doesNotContain("{{CONCEPT_TAG_RULE}}");
    }

    @Test
    void scopeModeRelaxesGroundingToUseMaterialAsRangeOnly() {
        String strict = GenerationPrompt.system(Subject.MATH, false);
        String scope = GenerationPrompt.system(Subject.MATH, true);

        // 엄격 모드: 자료가 곧 근거 — 외부 지식 금지, 원문 그대로 인용
        assertThat(strict).contains("외부 지식을 쓰지 않습니다");
        assertThat(strict).contains("글자 하나 바꾸지 않고 그대로");
        // 범위 모드: 자료는 '범위'만, 새 예문 생성 허용 — 대신 학년·범위·사실 정확성으로 묶는다
        assertThat(scope).contains("범위(scope) 기반 출제");
        assertThat(scope).contains("새 예문");
        assertThat(scope).doesNotContain("외부 지식을 쓰지 않습니다");
        assertThat(scope).doesNotContain("{{GROUNDING_RULE}}");
    }

    @Test
    void userPromptStatesCountSubjectAndGrade() {
        String user = GenerationPrompt.user(new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 5, List.of(material)));

        assertThat(user).contains("과목: KOREAN");
        assertThat(user).contains("5개 (no 1..5)");
        assertThat(user).contains("참고 학년: 2학년");
    }

    @Test
    void materialsAreEmbeddedForGrounding() {
        String user = GenerationPrompt.user(new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 3, List.of(material)));

        // 자료 본문이 실려야 "자료 밖으로 나가지 말라"는 지시가 의미를 갖는다
        assertThat(user).contains("<학습자료>");
        assertThat(user).contains("학교에 갔다. 꽃이 피었다.");
        assertThat(user).contains("자료 id=m-1");
        assertThat(user).contains("자료 밖 어휘·내용은 쓰지 말 것");
    }

    @Test
    void typeGuideExplainsTheAnswerShapePerType() {
        String dictation = GenerationPrompt.user(command(AssignmentType.DICTATION));
        String multipleChoice = GenerationPrompt.user(command(AssignmentType.MULTIPLE_CHOICE));
        String ox = GenerationPrompt.user(command(AssignmentType.OX));

        // 유형마다 answer/answerText/choices 중 무엇을 채울지가 달라 채점이 갈린다
        assertThat(dictation).contains("answerText에 정답 문장");
        assertThat(multipleChoice).contains("answer는 정답 인덱스");
        assertThat(ox).contains("0=O,1=X");
    }

    @Test
    void focusTagsAreIncludedOnlyWhenPresent() {
        String withFocus = GenerationPrompt.user(new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 5, List.of(material),
                List.of("받침규칙", "조사 을/를")));
        String withoutFocus = GenerationPrompt.user(command(AssignmentType.DICTATION));

        assertThat(withFocus).contains("집중 개념(약점 보강): 받침규칙, 조사 을/를");
        assertThat(withoutFocus).doesNotContain("집중 개념");
    }

    @Test
    void emptyFocusTagsBehaveLikeNone() {
        String user = GenerationPrompt.user(new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 5, List.of(material), List.of()));

        assertThat(user).doesNotContain("집중 개념");
    }

    @Test
    void targetLevelIsIncludedOnlyWhenSet() {
        String withLevel = GenerationPrompt.user(new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 5, List.of(material),
                List.of(), 3));

        assertThat(withLevel).contains("목표 난이도: level 3");
        // 난이도를 올려도 자료 밖으로 나가면 안 된다는 단서가 함께 붙어야 한다
        assertThat(withLevel).contains("자료 어휘·문장을 벗어나서 어렵게 만들지는 말 것");
        assertThat(GenerationPrompt.user(command(AssignmentType.DICTATION)))
                .doesNotContain("목표 난이도");
    }

    @Test
    void everyMaterialIsIncluded() {
        String user = GenerationPrompt.user(new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 5,
                List.of(material, new ResolvedMaterial("m-2", "받아쓰기 급수표", "나뭇잎, 옷걸이"))));

        assertThat(user).contains("자료 id=m-1").contains("자료 id=m-2");
        assertThat(user).contains("나뭇잎, 옷걸이");
    }

    private GenerationCommand command(AssignmentType type) {
        return new GenerationCommand(Subject.KOREAN, type, 2, 5, List.of(material));
    }
}
