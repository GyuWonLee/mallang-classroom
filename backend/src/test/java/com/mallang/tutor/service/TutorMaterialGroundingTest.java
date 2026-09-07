package com.mallang.tutor.service;

import com.mallang.material.repository.MaterialRepository;
import com.mallang.material.repository.MaterialTextView;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * 말랑이 참고 자료 조립 — 벡터 검색 없이 '키워드 겹침'으로 질문과 관련된 문단만 고른다.
 * 여기 테스트가 그 규칙을 고정한다: 관련 문단만 뽑고, 없으면 아무것도 붙이지 않는다(null).
 *
 * <p>"어떤 자료를 볼 것인가"(READY 만)는 이제 쿼리의 몫이라 {@code MaterialReadyScopeTest} 가
 * 실제 DB 위에서 검증한다. 여기서는 "고른 본문에서 어떤 문단을 뽑는가"만 본다.
 */
@ExtendWith(MockitoExtension.class)
class TutorMaterialGroundingTest {

    private static final Long CLASSROOM_ID = 5L;

    @Mock MaterialRepository materialRepository;

    private TutorMaterialGrounding grounding() {
        return new TutorMaterialGrounding(materialRepository);
    }

    private MaterialTextView materialWith(String title, String extractedText) {
        return new MaterialTextView(1L, title, extractedText);
    }

    @Test
    void picksOnlyTheParagraphRelatedToTheQuestion() {
        MaterialTextView material = materialWith("받아쓰기",
                "받침은 글자 아래에 붙는 자음이에요.\n\n곱셈은 같은 수를 여러 번 더하는 거예요.");
        when(materialRepository.findReadyTexts(CLASSROOM_ID)).thenReturn(List.of(material));

        String context = grounding().contextFor(CLASSROOM_ID, "받침이 뭐예요?");

        assertThat(context).contains("받침은 글자 아래에");
        assertThat(context).doesNotContain("곱셈");
        assertThat(context).contains("받아쓰기"); // 어느 자료에서 왔는지 표시
    }

    @Test
    void returnsNullWhenNoParagraphMatches() {
        MaterialTextView material = materialWith("받아쓰기", "곱셈은 같은 수를 여러 번 더하는 거예요.");
        when(materialRepository.findReadyTexts(CLASSROOM_ID)).thenReturn(List.of(material));

        assertThat(grounding().contextFor(CLASSROOM_ID, "받침이 뭐예요?")).isNull();
    }

    @Test
    void returnsNullWhenThereAreNoMaterials() {
        when(materialRepository.findReadyTexts(CLASSROOM_ID)).thenReturn(List.of());

        assertThat(grounding().contextFor(CLASSROOM_ID, "받침이 뭐예요?")).isNull();
    }

    @Test
    void skipsMaterialsThatHaveNoExtractedText() {
        MaterialTextView material = materialWith("처리중", null);
        when(materialRepository.findReadyTexts(CLASSROOM_ID)).thenReturn(List.of(material));

        assertThat(grounding().contextFor(CLASSROOM_ID, "받침이 뭐예요?")).isNull();
    }

    /**
     * 낱말이 하나뿐인 질문도 근거를 얻는다.
     *
     * <p>겹침 기준을 2점으로 고정했더니 "받침이 뭐예요?" 같은 <b>가장 흔한 형태</b>가 자료를
     * 눈앞에 두고도 근거를 못 얻었다. 뽑을 수 있는 최대치가 1점인 질문에서 1점은 우연이
     * 아니라 '가진 낱말이 전부 겹침'이다.
     */
    @Test
    void aQuestionWithOnlyOneKeywordStillFindsItsParagraph() {
        MaterialTextView material = materialWith("받아쓰기", "받침은 글자 아래에 붙는 자음이에요.");
        when(materialRepository.findReadyTexts(CLASSROOM_ID)).thenReturn(List.of(material));

        assertThat(grounding().contextFor(CLASSROOM_ID, "받침")).contains("받침은 글자 아래에");
    }

    /**
     * 의문형 어미는 낱말로 세지 않는다.
     *
     * <p>"뭐예요"가 불용어에 없으면 "받침이 뭐예요?"는 낱말이 <b>둘</b>로 세어지고, 자료에
     * "뭐예요"가 있을 리 없으니 최대 점수가 1이라 2점 기준을 영원히 못 넘는다.
     */
    @Test
    void questionEndingsAreNotCountedAsKeywords() {
        MaterialTextView material = materialWith("받아쓰기", "받침은 글자 아래에 붙는 자음이에요.");
        when(materialRepository.findReadyTexts(CLASSROOM_ID)).thenReturn(List.of(material));

        assertThat(grounding().contextFor(CLASSROOM_ID, "받침이 뭐예요?"))
                .isEqualTo(grounding().contextFor(CLASSROOM_ID, "받침"));
    }

    /**
     * 낱말이 여럿인 질문은 여전히 2점을 요구한다 — 한 낱말만 우연히 겹친 문단은 안 붙인다.
     */
    @Test
    void aParagraphSharingOnlyOneOfSeveralKeywordsIsNotUsed() {
        MaterialTextView material = materialWith("수학",
                "글자는 소리를 적은 것이에요.\n\n곱셈은 같은 수를 여러 번 더하는 거예요.");
        when(materialRepository.findReadyTexts(CLASSROOM_ID)).thenReturn(List.of(material));

        // '받침'과 '글자' 둘 중 '글자' 하나만 걸린다 → 1점이라 근거로 쓰지 않는다
        assertThat(grounding().contextFor(CLASSROOM_ID, "받침 글자")).isNull();
    }
}
