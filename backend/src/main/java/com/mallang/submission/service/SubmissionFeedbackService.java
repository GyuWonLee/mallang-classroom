package com.mallang.submission.service;

import com.mallang.assignment.ai.AiProperties;
import com.mallang.assignment.ai.GmsChatClients;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
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
 * 학생이 푼 과제 '전체'에 대한 AI 피드백 — 문제별이 아니라 과제 단위 총평이며, 대상이 학생이라
 * 학생에게 직접 말하는 따뜻한 말투로 쓴다. ai.provider=openai(GMS)면 LLM, 아니면(키 없음/실패) 템플릿.
 */
@Slf4j
@Service
public class SubmissionFeedbackService {

    /** 학생이 답안 화면을 여는 동안 붙잡고 있는 시간이라 넉넉하되 반드시 상한을 둔다. */
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(15);

    private final AiProperties properties;
    private final ObjectMapper objectMapper;
    /** GMS 설정이 없으면 null. 이 필드가 곧 "GMS 를 부를 수 있는가" 다 — useGms() 참고. */
    private final RestClient rest;

    public SubmissionFeedbackService(AiProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        // 지연 생성하지 않는다: 싱글톤이라 동시 요청이 몰리면 클라이언트가 중복 생성되고,
        // 설정은 기동 시 한 번 바인딩되므로 미룰 이유가 없다.
        this.rest = GmsChatClients.orNull(properties, READ_TIMEOUT);
    }

    /**
     * 채점 결과(문항별 정오 + conceptTags)로 과제 총평을 만든다.
     * results 가 비어 있으면(문항 결과 없음) null 을 돌려줘 화면에서 피드백 영역을 숨길 수 있게 한다.
     */
    public String feedback(JsonNode results) {
        if (results == null || !results.isArray() || results.isEmpty()) {
            return null;
        }
        int correct = 0;
        int total = 0;
        Set<String> wrongTags = new LinkedHashSet<>();
        for (JsonNode r : results) {
            total++;
            if (r.path("correct").asBoolean()) {
                correct++;
            } else {
                for (JsonNode tag : r.path("conceptTags")) {
                    wrongTags.add(tag.asString());
                }
            }
        }
        List<String> weak = new ArrayList<>(wrongTags);

        if (!useGms()) {
            return template(weak);
        }
        try {
            return callGms(correct, total, weak);
        } catch (Exception e) {
            log.warn("과제 전체 피드백 LLM 호출 실패 — 템플릿으로 대체", e);
            return template(weak);
        }
    }

    /**
     * GMS 를 부를 수 있는가 = 클라이언트가 만들어졌는가. 설정 판단을 생성자 한 곳에만 두었으므로
     * "설정은 있는데 rest 는 null" 인 상태가 생길 수 없고, 따라서 callGms 의 rest 는 항상 non-null 이다.
     */
    private boolean useGms() {
        return rest != null;
    }

    private String callGms(int correct, int total, List<String> weak) {
        String system = """
                당신은 초등학생을 다정하게 격려하는 선생님입니다.
                학생이 방금 푼 과제 '전체'에 대한 짧은 피드백을 학생에게 직접 말하듯 씁니다.
                - 2~3문장, 초등학생이 이해하기 쉬운 따뜻하고 친근한 말투.
                - 잘한 점을 먼저 칭찬하고, 틀린 개념이 있으면 어떻게 다시 보면 좋을지 부드럽게 격려합니다.
                - 점수·정답 개수 같은 숫자는 쓰지 않습니다. 오직 문장만 출력합니다(따옴표·JSON 금지).
                """;
        String user = "맞은 문항 수: " + correct + " / 전체: " + total
                + "\n틀린 개념: " + (weak.isEmpty() ? "없음" : String.join(", ", weak));

        Map<String, Object> body = Map.of(
                "model", properties.openai().model(),
                "max_completion_tokens", 300,
                "messages", List.of(
                        Map.of("role", "system", "content", system),
                        Map.of("role", "user", "content", user)));

        String raw = rest.post()
                .uri(properties.openai().chatPath())
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String.class);

        String text = objectMapper.readTree(raw)
                .path("choices").path(0).path("message").path("content")
                .asString("").strip();
        return text.isEmpty() ? template(weak) : text;
    }

    private String template(List<String> weak) {
        if (weak.isEmpty()) {
            return "와, 문제를 모두 잘 풀었어요! 정말 열심히 했네요. 이대로 쭉 도전해봐요!";
        }
        return "문제를 끝까지 열심히 풀었어요! " + String.join(", ", weak)
                + " 부분만 한 번 더 천천히 보면 금방 익숙해질 거예요. 위의 다시 볼 문제로 같이 연습해봐요!";
    }
}
