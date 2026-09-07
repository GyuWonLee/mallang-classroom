package com.mallang.submission.service;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.submission.service.GradingService.GradeResult;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

class GradingServiceTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private final GradingService gradingService = new GradingService(objectMapper);

    @Test
    void gradesMultipleChoiceByAnswerIndex() {
        JsonNode content = objectMapper.readTree("""
                {"problems":[
                  {"no":1,"answer":0,"conceptTags":["맞춤법"]},
                  {"no":2,"answer":2,"conceptTags":["받침규칙"]}
                ]}""");
        JsonNode answers = objectMapper.readTree("{\"1\":0,\"2\":1}");

        GradeResult r = gradingService.grade(content, answers, AssignmentType.MULTIPLE_CHOICE);

        assertThat(r.totalCount()).isEqualTo(2);
        assertThat(r.correctCount()).isEqualTo(1);   // 1번 정답, 2번 오답
        assertThat(r.score()).isEqualTo((short) 50);
        assertThat(r.results().get(0).get("correct").asBoolean()).isTrue();
        assertThat(r.results().get(1).get("correct").asBoolean()).isFalse();
        assertThat(r.results().get(0).get("conceptTags").get(0).asString()).isEqualTo("맞춤법");
    }

    @Test
    void gradesDictationIgnoringSpacesAndPunctuation() {
        JsonNode content = objectMapper.readTree("""
                {"problems":[{"no":1,"answerText":"학교에 갔다.","conceptTags":["ㅆ받침"]}]}""");
        JsonNode answers = objectMapper.readTree("{\"1\":\"학교에갔다\"}");

        GradeResult r = gradingService.grade(content, answers, AssignmentType.DICTATION);

        assertThat(r.correctCount()).isEqualTo(1);
        assertThat(r.score()).isEqualTo((short) 100);
    }

    @Test
    void missingAnswerIsWrong() {
        JsonNode content = objectMapper.readTree("""
                {"problems":[{"no":1,"answer":0,"conceptTags":[]}]}""");
        JsonNode answers = objectMapper.readTree("{}");

        GradeResult r = gradingService.grade(content, answers, AssignmentType.OX);

        assertThat(r.correctCount()).isZero();
        assertThat(r.score()).isEqualTo((short) 0);
    }
}
