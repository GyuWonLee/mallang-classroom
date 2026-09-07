package com.mallang.submission.service;

import com.mallang.assignment.ai.AiProperties;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 과제 전체 AI 피드백 — 키 없이 템플릿 경로로 동작 확인 + 데모 출력.
 * 실행: .\gradlew.bat test --tests "*SubmissionFeedbackServiceTest" --info
 */
class SubmissionFeedbackServiceTest {

    private final ObjectMapper om = JsonMapper.builder().build();
    // ai.provider=stub (키 없음) → 템플릿 경로
    private final SubmissionFeedbackService service =
            new SubmissionFeedbackService(new AiProperties("stub", null, null, null, null), om);

    @Test
    void returnsNullWhenNoResults() {
        assertThat(service.feedback(null)).isNull();
        assertThat(service.feedback(om.readTree("[]"))).isNull();
    }

    @Test
    void praisesWhenAllCorrect() {
        String fb = service.feedback(om.readTree(
                "[{\"no\":1,\"correct\":true,\"conceptTags\":[\"맞춤법\"]},"
                        + "{\"no\":2,\"correct\":true,\"conceptTags\":[\"받침규칙\"]}]"));
        assertThat(fb).isNotBlank();
        System.out.println("\n[전부 맞힘] " + fb);
    }

    @Test
    void mentionsWrongConceptsWhenSome() {
        String fb = service.feedback(om.readTree(
                "[{\"no\":1,\"correct\":true,\"conceptTags\":[\"맞춤법\"]},"
                        + "{\"no\":2,\"correct\":false,\"conceptTags\":[\"받침규칙\"]},"
                        + "{\"no\":3,\"correct\":false,\"conceptTags\":[\"조사 을/를\"]}]"));
        assertThat(fb).contains("받침규칙").contains("조사 을/를");
        System.out.println("[일부 오답] " + fb + "\n");
    }
}
