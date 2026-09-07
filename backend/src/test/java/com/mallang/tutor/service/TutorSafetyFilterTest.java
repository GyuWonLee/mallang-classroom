package com.mallang.tutor.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 말랑이 안전 필터 — 명백한 욕설은 막되, 한국어 부분일치 오탐으로 <b>멀쩡한 학습 질문</b>을 막지 않는다.
 * 아래 '정상 질문' 케이스가 그 오탐 방지선을 고정한다(여기가 깨지면 아이가 정당한 질문을 못 하게 된다).
 */
class TutorSafetyFilterTest {

    private final TutorSafetyFilter filter = new TutorSafetyFilter();

    @Test
    void blocksClearProfanity() {
        assertThat(filter.blockedMessage("씨발 몰라").isPresent()).isTrue();
        assertThat(filter.blockedMessage("너 병신이야").isPresent()).isTrue();
        assertThat(filter.blockedMessage("지랄하지마").isPresent()).isTrue();
    }

    @Test
    void blocksConsonantAbbreviations() {
        assertThat(filter.blockedMessage("ㅅㅂ").isPresent()).isTrue();
        assertThat(filter.blockedMessage("ㅂㅅ 진짜").isPresent()).isTrue();
    }

    @Test
    void blocksProfanityHiddenBySpacingOrPunctuation() {
        assertThat(filter.blockedMessage("ㅅ ㅂ").isPresent()).isTrue();
        assertThat(filter.blockedMessage("씨.발").isPresent()).isTrue();
    }

    @Test
    void blockedMessageGuidesTheChildKindly() {
        assertThat(filter.blockedMessage("씨발")).contains(TutorSafetyFilter.REDIRECT);
        assertThat(TutorSafetyFilter.REDIRECT).contains("말랑이");
    }

    @Test
    void doesNotFalselyBlockNormalLearningQuestions() {
        // 부분일치로 오탐 나기 쉬운 정상 낱말들 — 절대 막히면 안 된다
        assertThat(filter.blockedMessage("버스 시발점이 뭐예요?").isPresent()).isFalse(); // 始發
        assertThat(filter.blockedMessage("고양이 새끼는 뭐라고 불러요?").isPresent()).isFalse();
        assertThat(filter.blockedMessage("이 문제 아직 풀지 보지 못했어요").isPresent()).isFalse();
        assertThat(filter.blockedMessage("받침이 뭐예요?").isPresent()).isFalse();
        assertThat(filter.blockedMessage("곱셈 알려줘").isPresent()).isFalse();
    }

    // ── 살펴봐야 할 신호 (막지 않는다) ────────────────────────────────────────

    /**
     * 이 목록의 존재 이유: 시스템 프롬프트는 아이에게 "믿을 수 있는 어른과 나눠 줘"라고
     * 말하는데, 어른에게 알리는 경로가 없었다.
     */
    @Test
    void flagsSelfHarmSignals() {
        assertThat(filter.concernSignal("죽고싶어요")).contains("자해·자살 신호");
        assertThat(filter.concernSignal("나 그냥 없어지고 싶어")).contains("자해·자살 신호");
    }

    @Test
    void flagsViolenceAndBullyingSignals() {
        assertThat(filter.concernSignal("아빠가 나를 때려요")).contains("폭력 피해 신호");
        assertThat(filter.concernSignal("애들이 나 왕따 시켜")).contains("괴롭힘 신호");
    }

    /**
     * <b>가장 중요한 케이스.</b> 자해를 말하는 아이를 "그런 말은 쓰지 말자"고 돌려세우면
     * 겨우 꺼낸 말을 막는 셈이 된다. 표시만 하고 답변은 정상적으로 나가야 한다.
     */
    @Test
    void aChildAskingForHelpIsNeverBlocked() {
        assertThat(filter.blockedMessage("죽고싶어요")).isEmpty();
        assertThat(filter.blockedMessage("아빠가 나를 때려요")).isEmpty();
        assertThat(filter.blockedMessage("애들이 나 왕따 시켜")).isEmpty();
    }

    /**
     * 표시가 너무 흔하면 아무도 안 보게 된다 — 그러면 있으나 마나다.
     * 저학년이 실제로 쓰는 과장 표현과 학습 질문은 걸리지 않아야 한다.
     */
    @Test
    void doesNotFlagOrdinaryChildTalk() {
        assertThat(filter.concernSignal("숙제 너무 많아서 힘들어요")).isEmpty();
        assertThat(filter.concernSignal("배고파 죽겠어요")).isEmpty();
        assertThat(filter.concernSignal("받침이 뭐예요?")).isEmpty();
        assertThat(filter.concernSignal("친구랑 싸웠어요")).isEmpty();
        assertThat(filter.concernSignal("임진왜란 때 사람들이 많이 죽었나요?")).isEmpty();
    }

    /** 욕과 함께 털어놓는 경우가 있다 — 차단되더라도 표시는 남아야 한다 */
    @Test
    void aSignalWrappedInProfanityIsStillFlagged() {
        assertThat(filter.blockedMessage("ㅅㅂ 죽고싶어")).isPresent();
        assertThat(filter.concernSignal("ㅅㅂ 죽고싶어")).contains("자해·자살 신호");
    }
}
