package com.mallang.report.service;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.assignment.service.AssignmentTargetResolver;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomMemberRepository.StudentGradeView;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.HeatmapDtos.AssignmentSubmissionsResponse;
import com.mallang.report.dto.HeatmapDtos.ProblemStat;
import com.mallang.submission.entity.Submission;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 과제별 제출 현황 — 미제출자 파악 + 재수업 대상 문항 찾기 */
@ExtendWith(MockitoExtension.class)
class AssignmentSubmissionsServiceTest {

    @Mock AssignmentRepository assignmentRepository;
    @Mock SubmissionRepository submissionRepository;
    @Mock ClassroomMemberRepository memberRepository;
    ObjectMapper objectMapper = new ObjectMapper();
    /*
      resolver 는 목이 아니라 진짜다. 여기서 지키려는 것이 "대상 학생만 세는가"라,
      대상 판정을 목으로 대신하면 정작 그 규칙은 아무도 안 지키게 된다.
    */
    AssignmentSubmissionsService service;

    @org.junit.jupiter.api.BeforeEach
    void setUp() {
        service = new AssignmentSubmissionsService(assignmentRepository, submissionRepository,
                memberRepository, new AssignmentTargetResolver(memberRepository), objectMapper);
    }

    /** 학급 명단(학년 포함) — 대상 지정이 없는 과제는 이 전원이 대상이다. */
    private void rosterOf(Long... ids) {
        List<StudentGradeView> roster = new java.util.ArrayList<>();
        for (Long id : ids) {
            StudentGradeView v = mock(StudentGradeView.class);
            lenient().when(v.getStudentId()).thenReturn(id);
            lenient().when(v.getGrade()).thenReturn((short) 1);
            roster.add(v);
        }
        lenient().when(memberRepository.findStudentGrades(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(roster);
    }

    /**
     * 대상이 정해진 과제는 <b>그 학생들만</b> 현황에 나온다.
     *
     * <p>예전에는 학급 전체를 세어, 1학년 둘에게만 낸 과제인데 학생별 현황에 전교생이 뜨고
     * 미제출 명단에 대상이 아닌 아이가 잡혔다. 선생님은 안 낸 적도 없는 아이를 독려하게 된다.</p>
     */
    @Test
    void countsOnlyTheStudentsTheAssignmentWasGivenTo() {
        assignmentExists(31L, 7L, "1학년 맞춤 문제");
        managerOf(7L, 1L);
        rosterOf(11L, 12L, 13L);
        // 대상은 11·12 뿐이다 (13 은 다른 학년)
        when(assignment.isVisibleTo(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any())).thenReturn(false);
        when(assignment.isVisibleTo(11L, (short) 1)).thenReturn(true);
        when(assignment.isVisibleTo(12L, (short) 1)).thenReturn(true);
        // submission() 이 안에서 스터빙하므로 when(...) 밖에서 먼저 만든다
        List<Submission> given =
                List.of(submission(11L, "김민수", (short) 80, 1, results(true), answers("3")));
        when(submissionRepository.findByAssignmentId(31L)).thenReturn(given);

        AssignmentSubmissionsResponse response = service.submissions(teacher(1L), 31L);

        assertThat(response.totalStudents()).isEqualTo(2);
        // 13 번은 대상이 아니다 — 미제출로 잡히면 안 된다
        assertThat(response.notSubmittedStudentIds()).containsExactly(12L);
    }

    @Test
    void reportsWhoSubmittedAndWhoDidNot() {
        assignmentExists(31L, 7L, "받아쓰기 3회차");
        managerOf(7L, 1L);
        rosterOf(11L, 12L, 13L);
        List<Submission> given = List.of(
                submission(11L, "김민수", (short) 80, 1, results(true, true, false), answers("3")),
                submission(12L, "이서연", (short) 100, 1, results(true, true, true), answers("1")));
        when(submissionRepository.findByAssignmentId(31L)).thenReturn(given);

        AssignmentSubmissionsResponse response = service.submissions(teacher(1L), 31L);

        assertThat(response.title()).isEqualTo("받아쓰기 3회차");
        assertThat(response.totalStudents()).isEqualTo(3);
        assertThat(response.submittedCount()).isEqualTo(2);
        // 13번은 아직 안 냈다 — 선생님이 독려할 대상
        assertThat(response.notSubmittedStudentIds()).containsExactly(13L);
    }

    @Test
    void problemAccuracyFlagsReteachTarget() {
        assignmentExists(31L, 7L, "받아쓰기");
        managerOf(7L, 1L);
        studentsAre(11L, 12L, 13L);
        // 3번 문항은 셋 다 틀렸다 → 정답률 0% → 재수업 대상
        List<Submission> given = List.of(
                submission(11L, "김민수", (short) 66, 1, results(true, true, false), answers("2")),
                submission(12L, "이서연", (short) 66, 1, results(true, true, false), answers("2")),
                submission(13L, "박지훈", (short) 66, 1, results(true, true, false), answers("4")));
        when(submissionRepository.findByAssignmentId(31L)).thenReturn(given);

        List<ProblemStat> problems = service.submissions(teacher(1L), 31L).problems();

        ProblemStat third = problems.stream().filter(p -> p.no() == 3).findFirst().orElseThrow();
        assertThat(third.accuracy()).isZero();
        assertThat(third.n()).isEqualTo(3);
        assertThat(third.band()).isEqualTo("RISK");
        // 오답 분포 — 많이 고른 오답이 앞에 온다 (2번을 둘이 골랐다)
        assertThat(third.choiceDistribution()).first()
                .satisfies(choice -> {
                    assertThat(choice.answer()).isEqualTo("2");
                    assertThat(choice.count()).isEqualTo(2);
                });
    }

    @Test
    void onlyLatestAttemptIsCounted() {
        assignmentExists(31L, 7L, "받아쓰기");
        managerOf(7L, 1L);
        studentsAre(11L);
        List<Submission> given = List.of(
                submission(11L, "김민수", (short) 30, 1, results(false, false, false), answers("2")),
                submission(11L, "김민수", (short) 100, 2, results(true, true, true), answers("1")));
        when(submissionRepository.findByAssignmentId(31L)).thenReturn(given);

        AssignmentSubmissionsResponse response = service.submissions(teacher(1L), 31L);

        assertThat(response.submittedCount()).isEqualTo(1);
        assertThat(response.submissions()).singleElement()
                .satisfies(s -> {
                    assertThat(s.score()).isEqualTo((short) 100);
                    assertThat(s.attemptNo()).isEqualTo(2);
                });
    }

    @Test
    void studentCannotViewSubmissionStatus() {
        assignmentExists(31L, 7L, "받아쓰기");
        ClassroomMember student = mock(ClassroomMember.class);
        when(student.getRole()).thenReturn(ClassroomRole.STUDENT);
        when(memberRepository.findByClassroomIdAndUserId(7L, 5L)).thenReturn(Optional.of(student));

        assertThatThrownBy(() -> service.submissions(teacher(5L), 31L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");
    }

    @Test
    void unknownAssignmentIs404() {
        when(assignmentRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.submissions(teacher(1L), 99L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("과제를 찾을 수 없습니다");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private void assignmentExists(Long assignmentId, Long classroomId, String title) {
        Assignment assignment = mock(Assignment.class);
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(classroomId);
        lenient().when(assignment.getId()).thenReturn(assignmentId);
        lenient().when(assignment.getTitle()).thenReturn(title);
        lenient().when(assignment.getClassroom()).thenReturn(classroom);
        // 대상 지정이 없는 과제 — 학급 전원이 받는다 (대상을 좁히는 테스트는 아래에서 따로 건다)
        lenient().when(assignment.isVisibleTo(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any())).thenReturn(true);
        when(assignmentRepository.findById(assignmentId)).thenReturn(Optional.of(assignment));
        this.assignment = assignment;
    }

    /** 방금 만든 과제 목 — 대상을 좁히는 테스트가 다시 스터빙할 수 있게 들고 있는다 */
    private Assignment assignment;

    private void managerOf(Long classroomId, Long userId) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(ClassroomRole.OWNER);
        lenient().when(memberRepository.findByClassroomIdAndUserId(classroomId, userId))
                .thenReturn(Optional.of(member));
    }

    private void studentsAre(Long... ids) {
        rosterOf(ids);
    }

    private String results(boolean... corrects) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < corrects.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append("{\"no\":").append(i + 1)
                    .append(",\"correct\":").append(corrects[i])
                    .append(",\"conceptTags\":[\"겹받침\"]}");
        }
        return sb.append(']').toString();
    }

    /** 3번 문항에 고른 답 (오답 분포 확인용) */
    private String answers(String thirdAnswer) {
        return "{\"1\":\"1\",\"2\":\"1\",\"3\":\"" + thirdAnswer + "\"}";
    }

    private Submission submission(Long studentId, String name, short score, int attemptNo,
                                  String results, String answers) {
        Submission submission = mock(Submission.class);
        User student = mock(User.class);
        lenient().when(student.getId()).thenReturn(studentId);
        lenient().when(student.getName()).thenReturn(name);
        lenient().when(submission.getStudent()).thenReturn(student);
        lenient().when(submission.getScore()).thenReturn(score);
        lenient().when(submission.getAttemptNo()).thenReturn(attemptNo);
        lenient().when(submission.getSubmittedAt()).thenReturn(LocalDateTime.of(2026, 7, 29, 10, 0));
        lenient().when(submission.getResults()).thenReturn(results);
        lenient().when(submission.getAnswers()).thenReturn(answers);
        return submission;
    }
}
