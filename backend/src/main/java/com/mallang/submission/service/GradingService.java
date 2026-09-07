package com.mallang.submission.service;

import com.mallang.assignment.entity.AssignmentType;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 제출 즉시 자동 채점 (명세 §7). content.problems 의 정답과 학생 답을 문항별로 비교한다.
 * - 선택형(객관식·OX·조사·퀴즈): answer 인덱스 일치
 * - 받아쓰기(DICTATION): answerText 와 공백·문장부호 무시 비교
 * results 에는 리포트 집계를 위해 문항별 정오와 conceptTags 를 함께 담는다.
 */
@Service
public class GradingService {

    private final ObjectMapper objectMapper;

    public GradingService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public record GradeResult(JsonNode results, short score, int correctCount, int totalCount) {
    }

    public GradeResult grade(JsonNode content, JsonNode answers, AssignmentType type) {
        JsonNode problems = content.path("problems");
        List<Map<String, Object>> results = new ArrayList<>();
        int correct = 0;
        int total = 0;

        for (JsonNode problem : problems) {
            int no = problem.path("no").asInt();
            JsonNode studentAnswer = answers.path(String.valueOf(no));
            boolean isCorrect = judge(problem, studentAnswer, type);
            total++;
            if (isCorrect) {
                correct++;
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("no", no);
            result.put("correct", isCorrect);
            result.put("conceptTags", tagsOf(problem));
            results.add(result);
        }

        short score = total == 0 ? 0 : (short) Math.round(correct * 100.0 / total);
        return new GradeResult(objectMapper.valueToTree(results), score, correct, total);
    }

    private boolean judge(JsonNode problem, JsonNode studentAnswer, AssignmentType type) {
        if (studentAnswer.isMissingNode() || studentAnswer.isNull()) {
            return false;
        }
        if (type == AssignmentType.DICTATION) {
            String expected = normalize(problem.path("answerText").asString(""));
            String actual = normalize(studentAnswer.asString(""));
            return !expected.isEmpty() && expected.equals(actual);
        }
        // 선택형 — 정답 인덱스 비교
        JsonNode answer = problem.path("answer");
        if (!answer.isNumber() || !studentAnswer.isNumber()) {
            return false;
        }
        return answer.asInt() == studentAnswer.asInt();
    }

    private List<String> tagsOf(JsonNode problem) {
        List<String> tags = new ArrayList<>();
        for (JsonNode tag : problem.path("conceptTags")) {
            tags.add(tag.asString());
        }
        return tags;
    }

    // 받아쓰기 비교용 정규화 — 공백·문장부호 제거 후 소문자화 (저학년 표기 차이 흡수)
    private String normalize(String text) {
        if (text == null) {
            return "";
        }
        return text.replaceAll("[\\s.,!?…\"'`~·]", "").toLowerCase();
    }
}
