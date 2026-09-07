package com.mallang.report.service;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ScoreTrendDtos.ScoreTrendResponse;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.ScoreTrendView;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 학생별 과제 점수 추이 (선생님용) — S15P11A407-137
 *
 * <p>report 는 집계만 담고 제출 이력이 없어 선생님이 "이 학생이 나아지고 있나"를 볼 수 없었다
 * (§11.4). 학생 본인은 /me/submissions 로 보는데 선생님 경로만 비어 있었다.</p>
 */
@ExtendWith(MockitoExtension.class)
class StudentScoreTrendServiceTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long STUDENT_ID = 20L;
    private static final Long TEACHER_ID = 1L;
    private static final LocalDateTime T1 = LocalDateTime.of(2026, 7, 1, 9, 0);

    @Mock AssignmentAccessGuard accessGuard;
    @Mock SubmissionRepository submissionRepository;

    private StudentScoreTrendService service;

    @BeforeEach
    void setUp() {
        service = new StudentScoreTrendService(accessGuard, submissionRepository);
    }

    @Test
    void listsSubmissionsOldestFirstSoTheLineReadsLeftToRight() {
        teacherViewing();
        trend(view(31L, "받아쓰기 1회", (short) 40, 1, T1),
                view(32L, "받아쓰기 2회", (short) 70, 1, T1.plusDays(7)),
                view(33L, "받아쓰기 3회", (short) 90, 1, T1.plusDays(14)));

        ScoreTrendResponse response = service.trend(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.submissions()).hasSize(3);
        assertThat(response.submissions().get(0).score()).isEqualTo((short) 40);
        assertThat(response.submissions().get(2).score()).isEqualTo((short) 90);
        assertThat(response.averageScore()).isEqualTo(66); // (40+70+90)/3
    }

    @Test
    void keepsOnlyTheLatestAttemptPerAssignment() {
        teacherViewing();
        // 같은 과제를 두 번 냈다 — 추이에는 지금 실력인 2차만 있어야 한다
        trend(view(31L, "받아쓰기 1회", (short) 30, 1, T1),
                view(31L, "받아쓰기 1회", (short) 80, 2, T1.plusDays(1)));

        ScoreTrendResponse response = service.trend(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.submissions()).hasSize(1);
        assertThat(response.submissions().get(0).score()).isEqualTo((short) 80);
        assertThat(response.submissions().get(0).attemptNo()).isEqualTo(2);
    }

    @Test
    void ungradedSubmissionsAreListedButLeftOutOfTheAverage() {
        teacherViewing();
        // 수동 채점 유형은 score 가 null — 0점으로 세면 평균이 실제보다 낮아진다
        trend(view(31L, "받아쓰기", (short) 80, 1, T1),
                view(32L, "그림 그리기", null, 1, T1.plusDays(1)));

        ScoreTrendResponse response = service.trend(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.submissions()).hasSize(2);
        assertThat(response.averageScore()).isEqualTo(80);
    }

    @Test
    void noSubmissionsIsEmptyNotAnError() {
        teacherViewing();
        trend();

        ScoreTrendResponse response = service.trend(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.submissions()).isEmpty();
        assertThat(response.averageScore()).isNull(); // 낼 게 없으면 평균도 없다(0점이 아니다)
    }

    @Test
    void studentCanSeeTheirOwnTrend() {
        when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(ClassroomRole.STUDENT);
        trend(view(31L, "받아쓰기", (short) 80, 1, T1));

        ScoreTrendResponse response = service.trend(
                new AuthUser(STUDENT_ID, Role.STUDENT, "김민수"), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.submissions()).hasSize(1);
    }

    @Test
    void studentCannotSeeAnotherStudentsTrend() {
        when(accessGuard.requireMember(CLASSROOM_ID, 99L)).thenReturn(ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service.trend(
                new AuthUser(99L, Role.STUDENT, "남의학생"), CLASSROOM_ID, STUDENT_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("본인 또는 학급 선생님");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void teacherViewing() {
        lenient().when(accessGuard.requireMember(CLASSROOM_ID, TEACHER_ID))
                .thenReturn(ClassroomRole.OWNER);
    }

    private void trend(ScoreTrendView... views) {
        List<ScoreTrendView> rows = List.of(views);
        when(submissionRepository.findScoreTrend(CLASSROOM_ID, STUDENT_ID)).thenReturn(rows);
    }

    private ScoreTrendView view(Long assignmentId, String title, Short score,
                                int attemptNo, LocalDateTime submittedAt) {
        ScoreTrendView v = mock(ScoreTrendView.class);
        lenient().when(v.getAssignmentId()).thenReturn(assignmentId);
        lenient().when(v.getTitle()).thenReturn(title);
        lenient().when(v.getSubject()).thenReturn(Subject.KOREAN);
        lenient().when(v.getType()).thenReturn(AssignmentType.DICTATION);
        lenient().when(v.getScore()).thenReturn(score);
        lenient().when(v.getAttemptNo()).thenReturn(attemptNo);
        lenient().when(v.getSubmittedAt()).thenReturn(submittedAt);
        return v;
    }

    private AuthUser teacher() {
        return new AuthUser(TEACHER_ID, Role.TEACHER, "김선생");
    }
}
