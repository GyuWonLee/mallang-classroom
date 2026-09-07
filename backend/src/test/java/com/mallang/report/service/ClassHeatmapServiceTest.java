package com.mallang.report.service;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.HeatmapDtos.ClassHeatmapResponse;
import com.mallang.report.dto.HeatmapDtos.HeatmapCell;
import com.mallang.submission.entity.Submission;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.submission.repository.SubmissionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 학급 히트맵 — 명세 §8 측정 규칙(밴드·표본 부족·반평균) 검증 */
@ExtendWith(MockitoExtension.class)
class ClassHeatmapServiceTest {

    @Mock SubmissionRepository submissionRepository;
    @Mock AssignmentAccessGuard accessGuard;
    @org.mockito.Spy ObjectMapper objectMapper = new ObjectMapper();
    @InjectMocks ClassHeatmapService service;

    @Test
    void buildsStudentByTagMatrixWithBandsAndClassAverage() {
        teacherOf(7L, 1L);
        // 민수: 겹받침 1/4 = 25% → RISK / 서연: 겹받침 4/4 = 100% → GOOD
        List<Submission> given = List.of(
                submission(11L, "김민수", 31L, results("겹받침", false, false, false, true)),
                submission(12L, "이서연", 31L, results("겹받침", true, true, true, true)));
        when(submissionRepository.findByClassroomId(7L)).thenReturn(given);

        ClassHeatmapResponse response = service.heatmap(teacher(1L), 7L);

        assertThat(response.tags()).containsExactly("겹받침");
        assertThat(response.students()).hasSize(2);

        HeatmapCell minsu = cellOf(response, "김민수", "겹받침");
        assertThat(minsu.accuracy()).isEqualTo(25);
        assertThat(minsu.n()).isEqualTo(4);
        assertThat(minsu.band()).isEqualTo("RISK");

        assertThat(cellOf(response, "이서연", "겹받침").band()).isEqualTo("GOOD");
        // 반평균 병기 — 개인 약점(25%)과 학급 공통 이슈를 구분하는 기준
        assertThat(response.classAverages()).singleElement()
                .satisfies(avg -> {
                    assertThat(avg.accuracy()).isEqualTo(63); // 5/8
                    assertThat(avg.n()).isEqualTo(8);
                });
    }

    @Test
    void tagWithFewerThanThreeSamplesIsInsufficientNotZero() {
        teacherOf(7L, 1L);
        // 표본 2개 — 저학년 찍기 노이즈라 밴드를 매기지 않는다
        List<Submission> given = List.of(
                submission(11L, "김민수", 31L, results("받침", false, false)));
        when(submissionRepository.findByClassroomId(7L)).thenReturn(given);

        ClassHeatmapResponse response = service.heatmap(teacher(1L), 7L);

        HeatmapCell cell = cellOf(response, "김민수", "받침");
        assertThat(cell.n()).isEqualTo(2);
        assertThat(cell.band()).isEqualTo("INSUFFICIENT");
        assertThat(cell.accuracy()).isEqualTo(0); // 수치는 주되 밴드로 판단하지 말라는 뜻
    }

    @Test
    void studentWhoNeverSolvedTagGetsInsufficientWithNullAccuracy() {
        teacherOf(7L, 1L);
        List<Submission> given = List.of(
                submission(11L, "김민수", 31L, results("겹받침", true, true, true)),
                submission(12L, "이서연", 32L, results("띄어쓰기", true, true, true)));
        when(submissionRepository.findByClassroomId(7L)).thenReturn(given);

        ClassHeatmapResponse response = service.heatmap(teacher(1L), 7L);

        // 서연은 겹받침 문항을 푼 적이 없다 — 0% 가 아니라 데이터 없음이다
        HeatmapCell empty = cellOf(response, "이서연", "겹받침");
        assertThat(empty.accuracy()).isNull();
        assertThat(empty.n()).isZero();
        assertThat(empty.band()).isEqualTo("INSUFFICIENT");
    }

    @Test
    void onlyLatestAttemptPerAssignmentCounts() {
        teacherOf(7L, 1L);
        // 같은 과제 1차(전부 오답) → 2차(전부 정답). 재시도로 표본이 부풀지 않고 최신만 반영
        List<Submission> given = List.of(
                submission(11L, "김민수", 31L, results("겹받침", false, false, false)),
                submission(11L, "김민수", 31L, results("겹받침", true, true, true)));
        when(submissionRepository.findByClassroomId(7L)).thenReturn(given);

        HeatmapCell cell = cellOf(service.heatmap(teacher(1L), 7L), "김민수", "겹받침");

        assertThat(cell.n()).isEqualTo(3);
        assertThat(cell.accuracy()).isEqualTo(100);
    }

    @Test
    void brokenResultsJsonIsSkippedInsteadOfFailingWholeHeatmap() {
        teacherOf(7L, 1L);
        List<Submission> given = List.of(
                submission(11L, "김민수", 31L, "{깨진 JSON"),
                submission(12L, "이서연", 32L, results("겹받침", true, true, true)));
        when(submissionRepository.findByClassroomId(7L)).thenReturn(given);

        ClassHeatmapResponse response = service.heatmap(teacher(1L), 7L);

        // 깨진 제출 하나가 반 전체 화면을 막지 않는다
        assertThat(response.students()).hasSize(2);
        assertThat(cellOf(response, "이서연", "겹받침").accuracy()).isEqualTo(100);
    }

    @Test
    void studentCannotViewClassHeatmap() {
        when(accessGuard.requireMember(7L, 5L)).thenReturn(ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service.heatmap(teacher(5L), 7L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private void teacherOf(Long classroomId, Long userId) {
        when(accessGuard.requireMember(classroomId, userId)).thenReturn(ClassroomRole.OWNER);
    }

    /** conceptTags 하나에 정오 배열을 붙인 results JSON */
    private String results(String tag, boolean... corrects) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < corrects.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append("{\"no\":").append(i + 1)
                    .append(",\"correct\":").append(corrects[i])
                    .append(",\"conceptTags\":[\"").append(tag).append("\"]}");
        }
        return sb.append(']').toString();
    }

    private Submission submission(Long studentId, String name, Long assignmentId, String results) {
        Submission submission = mock(Submission.class);
        User student = mock(User.class);
        lenient().when(student.getId()).thenReturn(studentId);
        lenient().when(student.getName()).thenReturn(name);
        lenient().when(student.getGrade()).thenReturn((short) 3);
        Assignment assignment = mock(Assignment.class);
        lenient().when(assignment.getId()).thenReturn(assignmentId);
        lenient().when(submission.getStudent()).thenReturn(student);
        lenient().when(submission.getAssignment()).thenReturn(assignment);
        lenient().when(submission.getResults()).thenReturn(results);
        return submission;
    }

    private HeatmapCell cellOf(ClassHeatmapResponse response, String studentName, String tag) {
        return response.students().stream()
                .filter(row -> studentName.equals(row.name()))
                .flatMap(row -> row.cells().stream())
                .filter(cell -> tag.equals(cell.tag()))
                .findFirst()
                .orElseThrow(() -> new AssertionError(studentName + "/" + tag + " 셀이 없음"));
    }
}
