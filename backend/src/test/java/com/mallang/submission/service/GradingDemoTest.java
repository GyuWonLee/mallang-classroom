package com.mallang.submission.service;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.submission.service.GradingService.GradeResult;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 제출 데이터·DB·키 없이 채점이 어떻게 나오는지 눈으로 보는 데모.
 * 샘플 과제(객관식 5문항)에 학생 답을 넣고 → 점수·문항별 정오·개념태그별 강약점을 출력한다.
 *
 * 실행: .\gradlew.bat test --tests "*GradingDemoTest" --info
 */
class GradingDemoTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private final GradingService gradingService = new GradingService(objectMapper);

    @Test
    void showGradingAndWeakStrongAreas() {
        // 108 생성기가 만드는 것과 같은 모양의 과제 content (객관식)
        JsonNode content = objectMapper.readTree("""
                {"problems":[
                  {"no":1,"prompt":"'학교에 __ 갔다'에 알맞은 조사","answer":0,"conceptTags":["조사 에/에게"]},
                  {"no":2,"prompt":"바르게 쓴 것은?","answer":2,"conceptTags":["받침규칙"]},
                  {"no":3,"prompt":"'꽃이'의 발음은?","answer":1,"conceptTags":["받침규칙","연음"]},
                  {"no":4,"prompt":"'책 __ 읽었다'에 알맞은 조사","answer":3,"conceptTags":["조사 을/를"]},
                  {"no":5,"prompt":"맞춤법이 맞는 것은?","answer":0,"conceptTags":["맞춤법"]}
                ]}""");
        // 학생 답: 1·5번 정답, 2·3·4번 오답 (받침규칙·조사 을/를 약함)
        JsonNode answers = objectMapper.readTree("{\"1\":0,\"2\":0,\"3\":2,\"4\":1,\"5\":0}");

        GradeResult result = gradingService.grade(content, answers, AssignmentType.MULTIPLE_CHOICE);

        System.out.println("\n===== 채점 결과 =====");
        System.out.printf("점수: %d점 (%d/%d 정답)%n",
                result.score(), result.correctCount(), result.totalCount());

        // 개념태그별 강약점 집계 (② 리포트가 할 일의 미리보기)
        Map<String, int[]> perTag = new LinkedHashMap<>(); // tag -> [correct, total]
        for (JsonNode r : result.results()) {
            boolean correct = r.get("correct").asBoolean();
            System.out.printf("  %d번: %s  (태그: %s)%n",
                    r.get("no").asInt(), correct ? "O" : "X", r.get("conceptTags"));
            for (JsonNode tag : r.get("conceptTags")) {
                int[] cnt = perTag.computeIfAbsent(tag.asString(), k -> new int[2]);
                if (correct) {
                    cnt[0]++;
                }
                cnt[1]++;
            }
        }

        System.out.println("\n----- 개념별 정답률 -----");
        perTag.forEach((tag, cnt) -> {
            int pct = cnt[1] == 0 ? 0 : cnt[0] * 100 / cnt[1];
            String mark = pct >= 80 ? "[잘함]" : (pct < 60 ? "[약점]" : "[보통]");
            System.out.printf("  %-12s %d/%d (%d%%)  %s%n", tag, cnt[0], cnt[1], pct, mark);
        });
        System.out.println("=====================\n");
    }
}
