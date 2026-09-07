package com.mallang.assignment.service;

import com.mallang.assignment.dto.AssignmentDtos.AssignmentSummaryResponse;
import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomMemberRepository.StudentGradeView;
import com.mallang.global.security.AuthUser;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.ClassroomScoreView;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 과제 목록 집계 (선생님) — S15P11A407-137
 *
 * <p>배너의 평균 제출률·평균 점수와 카드별 제출률을 얻으려면 과제 수만큼
 * GET /assignments/{id}/submissions 를 반복해야 했다(§11.2 #7).
 * AssignmentSummaryResponse 의 submitted·score 는 학생 본인용이라 선생님에겐 항상 null 이었다.</p>
 */
@ExtendWith(MockitoExtension.class)
class AssignmentListAggregatesTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long TEACHER_ID = 1L;

    @Mock AssignmentAccessGuard accessGuard;
    @Mock AssignmentRepository assignmentRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock SubmissionRepository submissionRepository;

    private AssignmentListAggregator aggregator() {
        /*
          목 대신 진짜 resolver 를 끼운다. 여기서 지키려는 것이 "분모가 대상 학생 수인가"라,
          대상 판정을 목으로 대신하면 정작 그 규칙은 아무도 안 지키게 된다.
        */
        return new AssignmentListAggregator(
                new AssignmentTargetResolver(memberRepository), submissionRepository);
    }

    @Test
    void eachCardCarriesItsOwnSubmissionRate() {
        // 학생 4명, 과제 31 에는 2명이 냈다 → 50%
        aggregate(studentCount(4), score(31L, 10L, (short) 80, 1), score(31L, 11L, (short) 60, 1));

        List<AssignmentSummaryResponse> list = aggregator()
                .withTeacherAggregates(CLASSROOM_ID, List.of(assignment(31L)));

        assertThat(list).hasSize(1);
        assertThat(list.get(0).totalStudents()).isEqualTo(4);
        assertThat(list.get(0).submittedCount()).isEqualTo(2);
        assertThat(list.get(0).submissionRate()).isEqualTo(50);
        assertThat(list.get(0).averageScore()).isEqualTo(70); // (80+60)/2
    }

    @Test
    void countsAStudentOnceEvenAfterResubmitting() {
        // 같은 학생이 두 번 냈다 — 제출자는 한 명이고 점수는 최신 시도가 기준이다
        aggregate(studentCount(2), score(31L, 10L, (short) 30, 1), score(31L, 10L, (short) 90, 2));

        AssignmentSummaryResponse card = aggregator()
                .withTeacherAggregates(CLASSROOM_ID, List.of(assignment(31L))).get(0);

        assertThat(card.submittedCount()).isEqualTo(1);
        assertThat(card.submissionRate()).isEqualTo(50);
        assertThat(card.averageScore()).isEqualTo(90);
    }

    @Test
    void ungradedSubmissionsCountAsSubmittedButNotInTheAverage() {
        // 수동 채점 유형은 score 가 null — 제출은 했으니 제출률에는 들어가야 한다
        aggregate(studentCount(2), score(31L, 10L, (short) 80, 1), score(31L, 11L, null, 1));

        AssignmentSummaryResponse card = aggregator()
                .withTeacherAggregates(CLASSROOM_ID, List.of(assignment(31L))).get(0);

        assertThat(card.submittedCount()).isEqualTo(2);
        assertThat(card.submissionRate()).isEqualTo(100);
        assertThat(card.averageScore()).isEqualTo(80);
    }

    @Test
    void assignmentNobodySubmittedShowsZeroRateAndNoAverage() {
        aggregate(studentCount(3));

        AssignmentSummaryResponse card = aggregator()
                .withTeacherAggregates(CLASSROOM_ID, List.of(assignment(31L))).get(0);

        // 아무도 안 낸 건 실제로 0% 다 — 여기서는 null 이 아니라 0 이 맞다
        assertThat(card.submissionRate()).isZero();
        assertThat(card.averageScore()).isNull();
    }

    @Test
    void classroomWithoutStudentsHasNoRate() {
        aggregate(studentCount(0));

        AssignmentSummaryResponse card = aggregator()
                .withTeacherAggregates(CLASSROOM_ID, List.of(assignment(31L))).get(0);

        // 분모가 0 — 비율이 정의되지 않는다
        assertThat(card.submissionRate()).isNull();
        assertThat(card.totalStudents()).isZero();
    }

    @Test
    void studentFacingFieldsStayEmptyForTeachers() {
        aggregate(studentCount(2), score(31L, 10L, (short) 80, 1));

        AssignmentSummaryResponse card = aggregator()
                .withTeacherAggregates(CLASSROOM_ID, List.of(assignment(31L))).get(0);

        // submitted·score 는 "나"를 전제한 값이라 선생님에겐 성립하지 않는다
        assertThat(card.submitted()).isNull();
        assertThat(card.score()).isNull();
    }

    /**
     * 분모는 <b>그 과제를 받는 학생 수</b>다.
     *
     * <p>학급 전체를 쓰던 때는 1학년 둘에게만 낸 과제를 둘 다 냈는데도 카드에 50%(4명 중 2명)로
     * 찍혔다. 선생님은 안 낸 아이를 찾아 명단을 뒤지게 된다 — 그런 아이는 없는데도.</p>
     */
    @Test
    void rateCountsOnlyTheStudentsTheAssignmentWasGivenTo() {
        // 학급 4명(id 0~3) 중 대상은 0·1 둘. 그 둘이 모두 냈다 → 100%
        aggregate(4, score(31L, 0L, (short) 80, 1), score(31L, 1L, (short) 60, 1));
        Assignment targeted = assignment(31L);
        when(targeted.isVisibleTo(any(), any())).thenReturn(false);
        when(targeted.isVisibleTo(0L, (short) 1)).thenReturn(true);
        when(targeted.isVisibleTo(1L, (short) 1)).thenReturn(true);

        AssignmentSummaryResponse card = aggregator()
                .withTeacherAggregates(CLASSROOM_ID, List.of(targeted)).get(0);

        assertThat(card.totalStudents()).isEqualTo(2);
        assertThat(card.submittedCount()).isEqualTo(2);
        assertThat(card.submissionRate()).isEqualTo(100);
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void aggregate(int students, ClassroomScoreView... scores) {
        List<ClassroomScoreView> rows = List.of(scores);
        /*
          목록을 **먼저** 만든다. when(...) 안에서 studentGrade() 를 부르면 그 안의 스터빙이
          바깥 스터빙 도중에 끼어들어 UnfinishedStubbingException 이 난다.
        */
        List<StudentGradeView> roster = java.util.stream.LongStream.range(0, students)
                .mapToObj(id -> studentGrade(id, (short) 1))
                .toList();
        lenient().when(memberRepository.findStudentGrades(any(), any())).thenReturn(roster);
        lenient().when(submissionRepository.findClassroomScores(CLASSROOM_ID)).thenReturn(rows);
    }

    private StudentGradeView studentGrade(long studentId, Short grade) {
        StudentGradeView v = mock(StudentGradeView.class);
        lenient().when(v.getStudentId()).thenReturn(studentId);
        lenient().when(v.getGrade()).thenReturn(grade);
        return v;
    }

    private List<Long> studentIds(int n) {
        return java.util.stream.LongStream.range(0, n).boxed().toList();
    }

    private int studentCount(int n) {
        return n;
    }

    private Assignment assignment(Long id) {
        Assignment a = mock(Assignment.class);
        lenient().when(a.getId()).thenReturn(id);
        lenient().when(a.getTitle()).thenReturn("받아쓰기");
        lenient().when(a.getSubject()).thenReturn(Subject.KOREAN);
        lenient().when(a.getType()).thenReturn(AssignmentType.DICTATION);
        lenient().when(a.getCreatedAt()).thenReturn(LocalDateTime.of(2026, 8, 1, 9, 0));
        // 대상 지정이 없는 과제 — 학급 전체가 받는다
        lenient().when(a.isVisibleTo(any(), any())).thenReturn(true);
        return a;
    }

    private ClassroomScoreView score(Long assignmentId, Long studentId, Short score, int attemptNo) {
        ClassroomScoreView v = mock(ClassroomScoreView.class);
        lenient().when(v.getAssignmentId()).thenReturn(assignmentId);
        lenient().when(v.getStudentId()).thenReturn(studentId);
        lenient().when(v.getScore()).thenReturn(score);
        lenient().when(v.getAttemptNo()).thenReturn(attemptNo);
        return v;
    }

    private AuthUser teacher() {
        return new AuthUser(TEACHER_ID, Role.TEACHER, "김선생");
    }
}
