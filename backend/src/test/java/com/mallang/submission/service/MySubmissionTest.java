package com.mallang.submission.service;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.submission.dto.SubmissionDtos.MySubmissionDetailResponse;
import com.mallang.submission.dto.SubmissionDtos.MySubmissionResponse;
import com.mallang.submission.entity.Submission;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.MySubmissionView;
import com.mallang.user.entity.Role;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 내 제출 조회 — S15P11A407-129
 *
 * "내가 뭘 냈고 뭘 틀렸는지" 화면. 저학년 학습 도구에서 이걸 못 보면 복습이 불가능하다.
 */
@ExtendWith(MockitoExtension.class)
class MySubmissionTest {

    private static final LocalDateTime WHEN = LocalDateTime.of(2026, 7, 29, 10, 0);

    @Mock SubmissionRepository submissionRepository;
    @Mock AssignmentRepository assignmentRepository;
    @Mock AssignmentAccessGuard accessGuard;
    @Mock UserRepository userRepository;
    @Mock GradingService gradingService;
    @Mock SubmissionFeedbackService feedbackService;
    @Spy ObjectMapper objectMapper = new ObjectMapper();
    @InjectMocks SubmissionService service;

    @Test
    void listsOnlyLatestAttemptPerAssignment() {
        // 같은 과제를 두 번 냈다 — 목록엔 "지금 내 점수"인 2차만 나와야 한다
        List<MySubmissionView> given = List.of(
                view(2L, 31L, "받아쓰기 3회차", (short) 100, 2),
                view(1L, 31L, "받아쓰기 3회차", (short) 30, 1),
                view(3L, 32L, "낱말 퀴즈", (short) 80, 1));
        when(submissionRepository.findMineByStudentId(11L)).thenReturn(given);

        List<MySubmissionResponse> mine = service.mySubmissions(student(11L));

        assertThat(mine).hasSize(2);
        MySubmissionResponse dictation = mine.stream()
                .filter(s -> s.assignmentId().equals(31L)).findFirst().orElseThrow();
        assertThat(dictation.score()).isEqualTo((short) 100);
        assertThat(dictation.attemptNo()).isEqualTo(2);
        assertThat(dictation.assignmentTitle()).isEqualTo("받아쓰기 3회차");
    }

    @Test
    void studentWithNoSubmissionsGetsEmptyListNotError() {
        when(submissionRepository.findMineByStudentId(11L)).thenReturn(List.of());

        // 아직 아무것도 안 낸 건 정상 상태다 — 404 로 처리하면 신규 학생 화면이 깨진다
        assertThat(service.mySubmissions(student(11L))).isEmpty();
    }

    @Test
    void detailShowsMyAnswersAndPerProblemResult() {
        Submission submission = submission((short) 66,
                "{\"1\":\"1\",\"2\":\"1\",\"3\":\"2\"}",
                "[{\"no\":1,\"correct\":true},{\"no\":2,\"correct\":true},{\"no\":3,\"correct\":false}]");
        when(submissionRepository
                .findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(31L, 11L))
                .thenReturn(Optional.of(submission));

        MySubmissionDetailResponse detail = service.mySubmission(student(11L), 31L);

        assertThat(detail.score()).isEqualTo((short) 66);
        // 내가 3번에 뭘 골랐는지가 보여야 복습이 된다
        assertThat(detail.answers().get("3").asString()).isEqualTo("2");
        assertThat(detail.results().get(2).get("correct").asBoolean()).isFalse();
    }

    @Test
    void brokenStoredJsonStillShowsScore() {
        Submission submission = submission((short) 66, "{깨진 JSON", "[깨진 JSON");
        when(submissionRepository
                .findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(31L, 11L))
                .thenReturn(Optional.of(submission));

        MySubmissionDetailResponse detail = service.mySubmission(student(11L), 31L);

        // 답안이 깨졌어도 점수·제출시각은 보여준다 — 화면 전체가 막히는 것보다 낫다
        assertThat(detail.score()).isEqualTo((short) 66);
        assertThat(detail.answers()).isNull();
        assertThat(detail.results()).isNull();
    }

    @Test
    void notSubmittedYetIs404() {
        when(submissionRepository
                .findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(31L, 11L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.mySubmission(student(11L), 31L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("아직 제출하지 않은");
    }

    // ── 과제 전체 AI 총평: 온디맨드 + 캐시 ────────────────────────────────────

    @Test
    void firstViewGeneratesFeedbackAndCachesIt() {
        Submission submission = submission((short) 66, "{\"1\":\"1\"}",
                "[{\"no\":1,\"correct\":false,\"conceptTags\":[\"받침규칙\"]}]");
        when(submissionRepository
                .findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(31L, 11L))
                .thenReturn(Optional.of(submission));
        when(feedbackService.feedback(any())).thenReturn("받침규칙만 한 번 더 볼까요?");

        MySubmissionDetailResponse detail = service.mySubmission(student(11L), 31L);

        assertThat(detail.feedback()).isEqualTo("받침규칙만 한 번 더 볼까요?");
        // 다음 조회부터는 LLM 을 부르지 않도록 제출 행에 적어 둔다
        verify(submissionRepository).updateFeedback(7L, "받침규칙만 한 번 더 볼까요?");
    }

    @Test
    void cachedFeedbackIsReusedWithoutCallingLlm() {
        Submission submission = submission((short) 66, "{\"1\":\"1\"}",
                "[{\"no\":1,\"correct\":true}]");
        when(submission.getFeedback()).thenReturn("이미 적어 둔 총평이에요.");
        when(submissionRepository
                .findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(31L, 11L))
                .thenReturn(Optional.of(submission));

        MySubmissionDetailResponse detail = service.mySubmission(student(11L), 31L);

        // 새로고침할 때마다 총평 문구가 바뀌면 안 되고, 읽기마다 LLM 비용이 나가서도 안 된다
        assertThat(detail.feedback()).isEqualTo("이미 적어 둔 총평이에요.");
        verifyNoInteractions(feedbackService);
        verify(submissionRepository, never()).updateFeedback(anyLong(), anyString());
    }

    @Test
    void feedbackCacheFailureStillReturnsTheScreen() {
        Submission submission = submission((short) 66, "{\"1\":\"1\"}",
                "[{\"no\":1,\"correct\":false,\"conceptTags\":[\"받침규칙\"]}]");
        when(submissionRepository
                .findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(31L, 11L))
                .thenReturn(Optional.of(submission));
        when(feedbackService.feedback(any())).thenReturn("받침규칙만 한 번 더 볼까요?");
        doThrow(new DataIntegrityViolationException("db down"))
                .when(submissionRepository).updateFeedback(anyLong(), anyString());

        MySubmissionDetailResponse detail = service.mySubmission(student(11L), 31L);

        // 총평을 못 적었다고 복습 화면 전체가 막히면 안 된다
        assertThat(detail.feedback()).isEqualTo("받침규칙만 한 번 더 볼까요?");
        assertThat(detail.score()).isEqualTo((short) 66);
    }

    @Test
    void noGradedResultsMeansNoFeedbackAndNothingCached() {
        Submission submission = submission((short) 66, "{\"1\":\"1\"}", "[]");
        when(submissionRepository
                .findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(31L, 11L))
                .thenReturn(Optional.of(submission));
        when(feedbackService.feedback(any())).thenReturn(null);

        MySubmissionDetailResponse detail = service.mySubmission(student(11L), 31L);

        // 만들 게 없으면 프론트가 총평 영역을 숨긴다 — null 을 캐시하러 DB 를 건드리지 않는다
        assertThat(detail.feedback()).isNull();
        verify(submissionRepository, never()).updateFeedback(anyLong(), anyString());
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser student(Long id) {
        return new AuthUser(id, Role.STUDENT, "김민수");
    }

    private MySubmissionView view(Long submissionId, Long assignmentId, String title,
                                  short score, int attemptNo) {
        MySubmissionView v = mock(MySubmissionView.class);
        lenient().when(v.getSubmissionId()).thenReturn(submissionId);
        lenient().when(v.getAssignmentId()).thenReturn(assignmentId);
        lenient().when(v.getTitle()).thenReturn(title);
        lenient().when(v.getSubject()).thenReturn(Subject.KOREAN);
        lenient().when(v.getType()).thenReturn(AssignmentType.DICTATION);
        lenient().when(v.getScore()).thenReturn(score);
        lenient().when(v.getAttemptNo()).thenReturn(attemptNo);
        lenient().when(v.getSubmittedAt()).thenReturn(WHEN);
        return v;
    }

    private Submission submission(short score, String answers, String results) {
        Submission submission = mock(Submission.class);
        Assignment assignment = mock(Assignment.class);
        lenient().when(assignment.getTitle()).thenReturn("받아쓰기 3회차");
        lenient().when(submission.getId()).thenReturn(7L);
        lenient().when(submission.getAssignment()).thenReturn(assignment);
        lenient().when(submission.getScore()).thenReturn(score);
        lenient().when(submission.getAttemptNo()).thenReturn(1);
        lenient().when(submission.getSubmittedAt()).thenReturn(WHEN);
        lenient().when(submission.getAnswers()).thenReturn(answers);
        lenient().when(submission.getResults()).thenReturn(results);
        return submission;
    }
}
