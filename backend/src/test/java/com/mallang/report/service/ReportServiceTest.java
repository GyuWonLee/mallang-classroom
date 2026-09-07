package com.mallang.report.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.report.service.ReportService.Aggregation;
import com.mallang.report.service.ReportService.Recommendation;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.assignment.entity.Subject;
import com.mallang.submission.repository.SubmissionRepository.ReportRowView;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ReportServiceTest {

    @Mock SubmissionRepository submissionRepository;
    @Mock AssignmentAccessGuard accessGuard;
    @Mock ReportInsightService insightService;

    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    @Test
    void aggregatesStrengthsAndWeaknessesByConceptTag() {
        ReportService service = new ReportService(
                submissionRepository, accessGuard, insightService, objectMapper);

        ReportRowView r1 = row(1L,
                "[{\"no\":1,\"correct\":true,\"conceptTags\":[\"맞춤법\"]},"
                        + "{\"no\":2,\"correct\":false,\"conceptTags\":[\"받침규칙\"]}]");
        ReportRowView r2 = row(2L,
                "[{\"no\":1,\"correct\":false,\"conceptTags\":[\"받침규칙\"]}]");
        when(submissionRepository.findReportRows(10L, 20L))
                .thenReturn(List.of(r1, r2));

        Aggregation agg = service.aggregate(10L, 20L);

        assertThat(agg.gradedAssignments()).isEqualTo(2);
        assertThat(agg.overallCorrect()).isEqualTo(1);
        assertThat(agg.overallTotal()).isEqualTo(3);
        assertThat(agg.strengths()).containsExactly("맞춤법");   // 1/1
        assertThat(agg.weaknesses()).containsExactly("받침규칙"); // 0/2
        assertThat(agg.tagStats().get(0).tag()).isEqualTo("받침규칙"); // 약점 우선 정렬
    }

    @Test
    void recommendsAdvancedLevelWhenAccuracyIsHigh() {
        ReportService service = new ReportService(
                submissionRepository, accessGuard, insightService, objectMapper);
        // 5문항 전부 정답(100%, n=5) → 심화(3)
        ReportRowView r = row(1L,
                "[{\"no\":1,\"correct\":true,\"conceptTags\":[\"맞춤법\"]},"
                        + "{\"no\":2,\"correct\":true,\"conceptTags\":[\"맞춤법\"]},"
                        + "{\"no\":3,\"correct\":true,\"conceptTags\":[\"받침규칙\"]},"
                        + "{\"no\":4,\"correct\":true,\"conceptTags\":[\"받침규칙\"]},"
                        + "{\"no\":5,\"correct\":true,\"conceptTags\":[\"조사 을/를\"]}]");
        when(submissionRepository.findReportRows(10L, 20L)).thenReturn(List.of(r));

        Recommendation rec = service.recommend(service.aggregate(10L, 20L));

        assertThat(rec.level()).isEqualTo(5);            // 100% → 표시용 최고 난이도(5)
        assertThat(rec.generationLevel()).isEqualTo(3);  // 생성기 척도로는 심화(3)
        assertThat(rec.activities()).isNotEmpty();       // 약점 없음 → 도전 권유 활동
    }

    @Test
    void holdsAtBasicLevelWhenSampleTooSmall() {
        ReportService service = new ReportService(
                submissionRepository, accessGuard, insightService, objectMapper);
        // 채점 문항 n=1 < 3 → 찍기 노이즈 방지, 기본(2)으로 보류
        ReportRowView r = row(1L, "[{\"no\":1,\"correct\":false,\"conceptTags\":[\"받침규칙\"]}]");
        when(submissionRepository.findReportRows(10L, 20L)).thenReturn(List.of(r));

        Recommendation rec = service.recommend(service.aggregate(10L, 20L));

        assertThat(rec.level()).isEqualTo(3); // 표본 부족 → 5단계 중 가운데(보통, 3)로 보류
    }

    // ── 맞춤(보강) 문제를 어느 과목으로 낼지 ──────────────────────────────────

    /**
     * <b>과제 수가 아니라 틀린 문항 수로 센다.</b>
     *
     * <p>국어 과제를 여러 개 냈어도 거기서 한 문제만 틀리고 수학 한 과제에서 여럿 틀렸다면,
     * 보강해야 할 것은 수학이다. 과제 수로 세면 "많이 낸 과목"이 뽑혀 정작 약한 곳을 비켜간다.</p>
     */
    @Test
    void theWeakestSubjectIsTheOneWithTheMostWrongAnswers() {
        ReportService service = new ReportService(
                submissionRepository, accessGuard, insightService, objectMapper);

        ReportRowView korean1 = subjectRow(1L, Subject.KOREAN, "[{\"correct\":false}]");
        ReportRowView korean2 = subjectRow(2L, Subject.KOREAN, "[{\"correct\":true}]");
        ReportRowView math = subjectRow(3L, Subject.MATH,
                "[{\"correct\":false},{\"correct\":false},{\"correct\":false}]");
        when(submissionRepository.findReportRows(10L, 20L))
                .thenReturn(List.of(korean1, korean2, math));

        assertThat(service.weakestSubject(10L, 20L)).isEqualTo(Subject.MATH);
    }

    /** 다 맞았으면 보강할 과목이 없다 — 부르는 쪽이 기본값을 정하도록 null 을 준다. */
    @Test
    void thereIsNoWeakestSubjectWhenNothingWasWrong() {
        ReportService service = new ReportService(
                submissionRepository, accessGuard, insightService, objectMapper);

        // 목 생성이 when(...) 안에서 일어나면 스터빙이 중첩돼 Mockito 가 막는다 — 먼저 만든다
        ReportRowView allCorrect = subjectRow(1L, Subject.KOREAN, "[{\"correct\":true}]");
        when(submissionRepository.findReportRows(10L, 20L)).thenReturn(List.of(allCorrect));

        assertThat(service.weakestSubject(10L, 20L)).isNull();
    }

    /** 같은 과제를 두 번 냈으면 최신 시도만 센다 — 고친 답이 옛 오답으로 또 깎이면 안 된다 */
    @Test
    void onlyTheLatestAttemptOfEachAssignmentCounts() {
        ReportService service = new ReportService(
                submissionRepository, accessGuard, insightService, objectMapper);

        // 같은 과제(1번) 두 시도: 처음엔 셋 다 틀렸고 다시 풀어 다 맞았다
        ReportRowView first = subjectRow(1L, Subject.KOREAN,
                "[{\"correct\":false},{\"correct\":false},{\"correct\":false}]");
        ReportRowView retry = subjectRow(1L, Subject.KOREAN, "[{\"correct\":true}]");
        ReportRowView math = subjectRow(2L, Subject.MATH, "[{\"correct\":false}]");
        when(submissionRepository.findReportRows(10L, 20L))
                .thenReturn(List.of(first, retry, math));

        assertThat(service.weakestSubject(10L, 20L)).isEqualTo(Subject.MATH);
    }

    /** 집계가 보는 것은 (과제id, 유형, 채점결과) 세 칼럼뿐이다 — 엔티티가 아니라 프로젝션을 목으로 세운다 */
    private ReportRowView row(long assignmentId, String resultsJson) {
        ReportRowView row = mock(ReportRowView.class);
        when(row.getAssignmentId()).thenReturn(assignmentId);
        when(row.getResults()).thenReturn(resultsJson);
        return row;
    }

    /**
     * 과목까지 채운 행 — 약한 과목 판정에만 쓴다.
     *
     * <p>과목·채점결과는 {@code lenient} 다: 같은 과제의 옛 시도는 최신 시도에 밀려 <b>읽히지도
     * 않는 것이 정상</b>인데(그게 {@code onlyTheLatestAttemptOfEachAssignmentCounts} 의 요지다),
     * 엄격 모드는 그 안 쓰인 스텁을 실패로 본다.</p>
     */
    private ReportRowView subjectRow(long assignmentId, Subject subject, String resultsJson) {
        ReportRowView row = mock(ReportRowView.class);
        when(row.getAssignmentId()).thenReturn(assignmentId);
        lenient().when(row.getSubject()).thenReturn(subject);
        lenient().when(row.getResults()).thenReturn(resultsJson);
        return row;
    }
}
