package com.mallang.assignment.service;

import com.mallang.assignment.dto.AssignmentDtos.AssignmentSummaryResponse;
import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.entity.AssignmentSource;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.security.AuthUser;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.MyScoreView;
import com.mallang.user.entity.Role;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 과제 목록의 제출 여부 표시 — S15P11A407-130
 *
 * 학생이 목록에서 "안 한 과제"를 구분하지 못하면 같은 걸 계속 다시 푼다.
 */
@ExtendWith(MockitoExtension.class)
class AssignmentListSubmittedFlagTest {

    @Mock AssignmentRepository assignmentRepository;
    @Mock SubmissionRepository submissionRepository;
    @Mock UserRepository userRepository;
    @Mock AssignmentAccessGuard accessGuard;
    @Mock AssignmentListAggregator listAggregator;
    @Spy ObjectMapper objectMapper = new ObjectMapper();
    @InjectMocks AssignmentService service;

    @Test
    void studentSeesWhichAssignmentsAreDoneAndTheScore() {
        when(accessGuard.requireMember(7L, 11L)).thenReturn(ClassroomRole.STUDENT);
        List<Assignment> published = List.of(assignment(31L, "받아쓰기"), assignment(32L, "낱말 퀴즈"));
        when(assignmentRepository.findVisibleToStudent(7L, 11L, null)).thenReturn(published);
        // 31번만 냈다
        List<MyScoreView> scores = List.of(score(31L, (short) 80, 1));
        when(submissionRepository.findMyScoresInClassroom(7L, 11L)).thenReturn(scores);

        List<AssignmentSummaryResponse> list = service.list(student(11L), 7L);

        AssignmentSummaryResponse done = pick(list, 31L);
        assertThat(done.submitted()).isTrue();
        assertThat(done.score()).isEqualTo((short) 80);

        AssignmentSummaryResponse todo = pick(list, 32L);
        assertThat(todo.submitted()).isFalse();
        assertThat(todo.score()).isNull();
    }

    @Test
    void resubmittedAssignmentShowsLatestAttemptScore() {
        when(accessGuard.requireMember(7L, 11L)).thenReturn(ClassroomRole.STUDENT);
        List<Assignment> published = List.of(assignment(31L, "받아쓰기"));
        when(assignmentRepository.findVisibleToStudent(7L, 11L, null)).thenReturn(published);
        // 1차 30점 → 2차 100점. 목록엔 지금 상태인 100점이 나와야 한다
        List<MyScoreView> scores = List.of(score(31L, (short) 30, 1), score(31L, (short) 100, 2));
        when(submissionRepository.findMyScoresInClassroom(7L, 11L)).thenReturn(scores);

        assertThat(pick(service.list(student(11L), 7L), 31L).score()).isEqualTo((short) 100);
    }

    @Test
    void ungradedSubmissionStillCountsAsSubmitted() {
        when(accessGuard.requireMember(7L, 11L)).thenReturn(ClassroomRole.STUDENT);
        List<Assignment> published = List.of(assignment(31L, "말하기 녹음"));
        when(assignmentRepository.findVisibleToStudent(7L, 11L, null)).thenReturn(published);
        // 점수가 없는 유형도 낸 것은 사실이다 — submitted=false 로 보이면 다시 풀게 된다
        List<MyScoreView> scores = List.of(score(31L, null, 1));
        when(submissionRepository.findMyScoresInClassroom(7L, 11L)).thenReturn(scores);

        AssignmentSummaryResponse item = pick(service.list(student(11L), 7L), 31L);
        assertThat(item.submitted()).isTrue();
        assertThat(item.score()).isNull();
    }

    @Test
    void teacherListingSkipsTheSubmissionQuery() {
        when(accessGuard.requireMember(7L, 1L)).thenReturn(ClassroomRole.OWNER);
        List<Assignment> all = List.of(assignment(31L, "받아쓰기"));
        when(assignmentRepository.findByClassroomIdOrderByCreatedAtDesc(7L)).thenReturn(all);

        service.list(teacher(1L), 7L);

        // 선생님에게는 "누구 기준 제출"이 성립하지 않는다 — 내 제출 조회가 나가면 안 된다.
        // 대신 학급 집계로 위임한다 (집계 값 자체는 AssignmentListAggregatesTest 가 검증).
        verify(submissionRepository, never()).findMyScoresInClassroom(7L, 1L);
        verify(listAggregator).withTeacherAggregates(7L, all);
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser student(Long id) {
        return new AuthUser(id, Role.STUDENT, "김민수");
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private AssignmentSummaryResponse pick(List<AssignmentSummaryResponse> list, Long id) {
        return list.stream().filter(a -> a.id().equals(id)).findFirst().orElseThrow();
    }

    private Assignment assignment(Long id, String title) {
        Assignment assignment = mock(Assignment.class);
        lenient().when(assignment.getId()).thenReturn(id);
        lenient().when(assignment.getTitle()).thenReturn(title);
        lenient().when(assignment.getSubject()).thenReturn(Subject.KOREAN);
        lenient().when(assignment.getType()).thenReturn(AssignmentType.DICTATION);
        lenient().when(assignment.getSource()).thenReturn(AssignmentSource.MANUAL);
        lenient().when(assignment.getCreatedAt()).thenReturn(LocalDateTime.of(2026, 7, 28, 9, 0));
        lenient().when(assignment.getPublishedAt()).thenReturn(LocalDateTime.of(2026, 7, 28, 9, 0));
        return assignment;
    }

    private MyScoreView score(Long assignmentId, Short score, int attemptNo) {
        MyScoreView view = mock(MyScoreView.class);
        lenient().when(view.getAssignmentId()).thenReturn(assignmentId);
        lenient().when(view.getScore()).thenReturn(score);
        lenient().when(view.getAttemptNo()).thenReturn(attemptNo);
        return view;
    }
}
