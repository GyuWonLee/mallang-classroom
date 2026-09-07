package com.mallang.tutor.service;

import com.mallang.assignment.ai.AiProperties;
import com.mallang.tutor.entity.TutorActionType;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 말랑이 응답 파싱 — 모델 출력이 계약을 안 지키는 경우를 전부 여기서 흡수한다.
 *
 * <p>지키려는 것 세 가지다. ① 모델이 규칙을 어기고 문장만 답해도 <b>그 답은 살린다</b>(저학년
 * 화면이 폴백 안내로 떨어지지 않게). ② 그렇다고 아무거나 살리지는 않는다 — 잘린 JSON 부스러기나
 * 빈 답은 null 로 버려서 안내 문구가 나가게 한다(아이 말풍선에 날 JSON 이 뜨면 안 된다).
 * ③ 기계 용어가 아이 화면에 새어 나가지 않는다.</p>
 */
class AiTutorClientParseTest {

    /** 키가 없으면 RestClient 가 null 이라 HTTP 를 타지 않는다 — 파싱만 떼어 본다. */
    private final AiTutorClient client = new AiTutorClient(
            new AiProperties("stub", null, null, null, null), JsonMapper.builder().build(),
            500, 400);

    @Test
    void readsAnswerAndAskTeacherProposal() {
        TutorReply reply = client.parse("""
                {"answer":"그건 선생님께 여쭤보자!",
                 "action":{"type":"ASK_TEACHER","content":"민수가 시험 범위를 궁금해합니다."}}
                """);

        assertThat(reply.answer()).isEqualTo("그건 선생님께 여쭤보자!");
        assertThat(reply.action().type()).isEqualTo(TutorActionType.ASK_TEACHER);
        assertThat(reply.action().content()).isEqualTo("민수가 시험 범위를 궁금해합니다.");
    }

    @Test
    void keepsAskTeacherProposalThatHasOnlyContent() {
        // 예전에는 title 이 없으면 통째로 버렸다. 이제 title 은 요구하지 않는다 —
        // 선생님에게 보낼 때도 학생 화면에서도 쓰이지 않는데 질문마다 생성 토큰만 먹었다
        TutorReply reply = client.parse(
                "{\"answer\":\"내가 대신 여쭤봐 줄까?\",\"action\":{\"type\":\"ASK_TEACHER\","
                        + "\"content\":\"민수가 받침 규칙을 어려워합니다.\"}}");

        assertThat(reply.action()).isNotNull();
        assertThat(reply.action().type()).isEqualTo(TutorActionType.ASK_TEACHER);
        assertThat(reply.action().content()).isEqualTo("민수가 받침 규칙을 어려워합니다.");
        assertThat(reply.action().title()).isNull(); // 컬럼은 남았지만 더 이상 채우지 않는다
    }

    @Test
    void stripsCodeFenceTheModelSometimesAdds() {
        TutorReply reply = client.parse("""
                ```json
                {"answer":"받침은 글자 아래에 붙어!","action":null}
                ```""");

        assertThat(reply.answer()).isEqualTo("받침은 글자 아래에 붙어!");
        assertThat(reply.action()).isNull();
    }

    @Test
    void plainTextStillBecomesAnAnswer() {
        // 형식이 깨졌다고 아이에게 폴백 안내를 보내는 것보다, 답을 살리고 제안만 버린다
        TutorReply reply = client.parse("받침은 글자 아래에 붙는 자음이야!");

        assertThat(reply.answer()).isEqualTo("받침은 글자 아래에 붙는 자음이야!");
        assertThat(reply.action()).isNull();
    }

    @Test
    void dropsTruncatedJsonInsteadOfShowingItToTheChild() {
        // 토큰 상한에 걸려 잘린 응답이다. 살리려 들면 `{"answer": "받침은…` 이 그대로
        // 초등학생 말풍선에 뜬다 — 날 JSON 을 보여주느니 안내 문구가 낫다
        TutorReply reply = client.parse("{\"answer\": \"받침은 글자 아래에");

        assertThat(reply).isNull();
    }

    @Test
    void scrubsMechanismWordsThatLeakedIntoTheAnswer() {
        TutorReply reply = client.parse(
                "{\"answer\":\"ASK_TEACHER: 선생님께 여쭤볼까?\",\"action\":null}");

        // 프롬프트로도 금지하지만 모델의 준수를 믿지 않는다 — 아이 화면에 나가면 안 된다
        assertThat(reply.answer()).isEqualTo("선생님께 여쭤볼까?");
        assertThat(reply.answer()).doesNotContain("ASK_TEACHER");
    }

    @Test
    void dropsHalfFilledAskTeacherProposal() {
        TutorReply reply = client.parse(
                "{\"answer\":\"물어봐 줄까?\",\"action\":{\"type\":\"ASK_TEACHER\",\"title\":\"제목\"}}");

        // content 가 없으면 선생님에게 보낼 것이 없다 — 제안을 통째로 버린다
        assertThat(reply.answer()).isEqualTo("물어봐 줄까?");
        assertThat(reply.action()).isNull();
    }

    @Test
    void noLongerAcceptsShowMaterialAsAProposal() {
        TutorReply reply = client.parse(
                "{\"answer\":\"자료에 나와 있어!\",\"action\":{\"type\":\"SHOW_MATERIAL\",\"materialId\":12}}");

        /*
          모양이 완벽한 SHOW_MATERIAL 이어도 이제 제안으로 받지 않는다. 학생 화면이 이 제안에
          버튼을 만들지 않아, 아이에게는 "내가 열어 줄까?" 라는 말만 보이고 열 방법이 없었다.
          답은 그대로 살리고 제안만 버린다.
        */
        assertThat(reply.answer()).isEqualTo("자료에 나와 있어!");
        assertThat(reply.action()).isNull();
    }

    @Test
    void dropsShowMaterialWhateverTheIdLooksLike() {
        TutorReply reply = client.parse(
                "{\"answer\":\"자료 볼래?\",\"action\":{\"type\":\"SHOW_MATERIAL\",\"materialId\":\"열두번째\"}}");

        // 예전에는 id 가 숫자가 아니라서 버렸다 — 이제는 id 모양과 상관없이 타입만 보고 버린다
        assertThat(reply.answer()).isEqualTo("자료 볼래?");
        assertThat(reply.action()).isNull();
    }

    @Test
    void dropsUnknownActionTypes() {
        // 우리가 만들지 않은 액션을 모델이 지어내도 조용히 버린다
        TutorReply reply = client.parse(
                "{\"answer\":\"음\",\"action\":{\"type\":\"DELETE_EVERYTHING\"}}");

        assertThat(reply.answer()).isEqualTo("음");
        assertThat(reply.action()).isNull();
    }

    @Test
    void dropsJsonWhoseAnswerIsEmpty() {
        // 예전에는 원문 전체를 답으로 삼았는데, 그러면 `{"answer": "", ...}` 가 그대로 아이에게
        // 갔다. 애초에 보여줄 문장이 없는 응답이니 안내 문구로 넘긴다
        TutorReply reply = client.parse("{\"answer\":\"\",\"action\":null}");

        assertThat(reply).isNull();
    }
}
