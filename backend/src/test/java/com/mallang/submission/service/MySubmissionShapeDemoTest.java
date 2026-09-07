package com.mallang.submission.service;

import com.mallang.assignment.ai.AiProperties;
import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.global.security.AuthUser;
import com.mallang.submission.dto.SubmissionDtos.MySubmissionDetailResponse;
import com.mallang.submission.entity.Submission;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * '내 답안 다시 보기' 응답 모양 — 채점 결과(no·correct)에 과제 content(발문·보기·정답)와
 * 내가 고른 답이 문항 번호로 합쳐져 나가는지 실제 서비스(buildReview)로 검증한다.
 *
 * <p>프론트가 이 병합 결과를 그대로 그리므로 필드가 하나 빠지면 화면에서 문제가 안 보인다.
 * DB·API 키는 필요 없다 — 키가 없으면 총평은 템플릿 경로로 떨어진다.</p>
 */
class MySubmissionShapeDemoTest {

    private final ObjectMapper om = JsonMapper.builder().build();

    @Test
    void mergesProblemTextWithGradingResultByProblemNo() {
        // 과제 content(발문·보기·정답) — 3문항 객관식
        String content = """
                {"problems":[
                  {"no":1,"prompt":"'학교에 ○○.' 알맞은 말은?","choices":["갔다","같다","갓다"],"answer":0,"conceptTags":["맞춤법"]},
                  {"no":2,"prompt":"'꽃이 피었다'의 받침 소리는?","choices":["꼳","꽃","꼿"],"answer":0,"conceptTags":["받침규칙"]},
                  {"no":3,"prompt":"'책○ 읽다' 알맞은 조사?","choices":["을","를","이"],"answer":0,"conceptTags":["조사 을/를"]}
                ]}""";
        String results = """
                [{"no":1,"correct":true,"conceptTags":["맞춤법"]},
                 {"no":2,"correct":false,"conceptTags":["받침규칙"]},
                 {"no":3,"correct":true,"conceptTags":["조사 을/를"]}]""";
        String answers = "{\"1\":0,\"2\":1,\"3\":0}"; // 2번만 오답(1 골라 틀림)

        Assignment assignment = mock(Assignment.class);
        when(assignment.getTitle()).thenReturn("받아쓰기 3회차");
        when(assignment.getContent()).thenReturn(content);
        Submission submission = mock(Submission.class);
        when(submission.getId()).thenReturn(101L);
        when(submission.getAssignment()).thenReturn(assignment);
        when(submission.getScore()).thenReturn((short) 67);
        when(submission.getAttemptNo()).thenReturn(1);
        when(submission.getSubmittedAt()).thenReturn(LocalDateTime.of(2026, 7, 29, 10, 0));
        when(submission.getResults()).thenReturn(results);
        when(submission.getAnswers()).thenReturn(answers);

        SubmissionRepository repo = mock(SubmissionRepository.class);
        when(repo.findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(31L, 20L))
                .thenReturn(Optional.of(submission));

        SubmissionService service = new SubmissionService(
                repo, mock(AssignmentRepository.class), mock(AssignmentAccessGuard.class),
                mock(UserRepository.class), mock(GradingService.class),
                new SubmissionFeedbackService(new AiProperties("stub", null, null, null, null), om), om);

        MySubmissionDetailResponse response = service.mySubmission(new AuthUser(20L, Role.STUDENT), 31L);

        assertThat(response.assignmentTitle()).isEqualTo("받아쓰기 3회차");
        assertThat(response.score()).isEqualTo((short) 67);
        assertThat(response.results()).hasSize(3);

        // 틀린 2번 — 발문·보기·정답이 다 실려야 학생이 "뭘 틀렸는지"를 볼 수 있다
        JsonNode wrong = response.results().get(1);
        assertThat(wrong.get("no").asInt()).isEqualTo(2);
        assertThat(wrong.get("prompt").asString()).isEqualTo("'꽃이 피었다'의 받침 소리는?");
        assertThat(wrong.get("choices")).hasSize(3);
        assertThat(wrong.get("answer").asInt()).isEqualTo(0);   // 정답
        assertThat(wrong.get("myAnswer").asInt()).isEqualTo(1); // 내가 고른 답
        assertThat(wrong.get("correct").asBoolean()).isFalse();

        JsonNode right = response.results().get(0);
        assertThat(right.get("correct").asBoolean()).isTrue();
        assertThat(right.get("myAnswer").asInt()).isEqualTo(0);

        // 객관식이라 받아쓰기 정답 칸은 비어 있다 — 키 자체는 있어야 프론트가 분기할 수 있다
        assertThat(wrong.has("answerText")).isTrue();
        assertThat(wrong.get("answerText").isNull()).isTrue();

        // 키가 없으면 템플릿 총평 — 틀린 개념을 짚어 준다
        assertThat(response.feedback()).contains("받침규칙");
    }
}
