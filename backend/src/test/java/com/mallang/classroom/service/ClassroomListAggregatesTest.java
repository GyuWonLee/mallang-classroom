package com.mallang.classroom.service;

import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomResponse;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomMemberRepository.StudentCountView;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.assignment.repository.AssignmentRepository.PublishedCountView;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.user.entity.User;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.AssignmentSubmitterView;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
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
 * 학급 목록 집계 — S15P11A407-137
 *
 * <p>카드마다 학생 수·진행중 여부를 보여주려면 학급마다 상세를 다시 불러야 했고, 과제 진행률은
 * 아예 구할 방법이 없었다(§11.2 #6). 목록 화면이라 학급이 늘수록 그대로 왕복 횟수가 된다.</p>
 *
 * <p>여기서 고정하는 것은 "학급이 몇 개든 쿼리 수가 늘지 않는다"와 진행률 계산 규칙이다.</p>
 */
@ExtendWith(MockitoExtension.class)
class ClassroomListAggregatesTest {

    private static final LocalDateTime NOW = LocalDateTime.of(2026, 8, 1, 9, 0);

    @Mock ClassroomRepository classroomRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock AssignmentRepository assignmentRepository;
    @Mock SubmissionRepository submissionRepository;
    @InjectMocks ClassroomService service;

    @Test
    void eachCardCarriesItsOwnStudentCountAndLiveFlag() {
        myClassrooms(membership(1L, "2학년 3반"), membership(2L, "3학년 1반"));
        studentCounts(count(1L, 25), count(2L, 18));
        activeSessions(session(99L, 1L));
        publishedCounts();
        submitters();

        List<ClassroomResponse> classrooms = service.listMyClassrooms(teacher());

        assertThat(classrooms).hasSize(2);
        assertThat(classrooms.get(0).studentCount()).isEqualTo(25);
        assertThat(classrooms.get(0).activeSession()).isNotNull();
        assertThat(classrooms.get(0).activeSession().id()).isEqualTo(99L);
        // 두 번째 학급은 수업 중이 아니다
        assertThat(classrooms.get(1).studentCount()).isEqualTo(18);
        assertThat(classrooms.get(1).activeSession()).isNull();
    }

    @Test
    void assignmentProgressIsSubmittedPairsOverStudentsTimesAssignments() {
        myClassrooms(membership(1L, "2학년 3반"));
        studentCounts(count(1L, 10));
        activeSessions();
        publishedCounts(published(1L, 2));
        // 과제 2개 × 학생 10명 = 20칸 중, 5 + 5 = 10칸이 찼다
        submitters(submitter(1L, 31L, 5), submitter(1L, 32L, 5));

        List<ClassroomResponse> classrooms = service.listMyClassrooms(teacher());

        assertThat(classrooms.get(0).assignmentProgress()).isEqualTo(50);
    }

    @Test
    void noPublishedAssignmentsMeansNoProgressNotZero() {
        myClassrooms(membership(1L, "2학년 3반"));
        studentCounts(count(1L, 10));
        activeSessions();
        publishedCounts(); // 아직 낸 과제가 없다
        submitters();

        // 0% 는 "다들 안 냈다"는 뜻이라 화면에서 빨간 막대가 된다. 낼 게 없는 것과는 다르다
        assertThat(service.listMyClassrooms(teacher()).get(0).assignmentProgress()).isNull();
    }

    @Test
    void classroomWithoutStudentsHasNoProgressEither() {
        myClassrooms(membership(1L, "빈 학급"));
        studentCounts();
        activeSessions();
        publishedCounts(published(1L, 3));
        submitters();

        // 분모가 0 — 나누면 터진다
        assertThat(service.listMyClassrooms(teacher()).get(0).assignmentProgress()).isNull();
        assertThat(service.listMyClassrooms(teacher()).get(0).studentCount()).isZero();
    }

    @Test
    void studentWithNoClassroomsGetsEmptyListWithoutQueryingAggregates() {
        when(memberRepository.findWithClassroomByUserId(any())).thenReturn(List.of());

        assertThat(service.listMyClassrooms(teacher())).isEmpty();

        // 학급이 없으면 in-절이 빈 목록이 된다 — 굳이 물어보지 않는다
        org.mockito.Mockito.verify(assignmentRepository, org.mockito.Mockito.never())
                .countPublishedByClassroomIds(any());
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void myClassrooms(ClassroomMember... members) {
        List<ClassroomMember> rows = List.of(members);
        when(memberRepository.findWithClassroomByUserId(any())).thenReturn(rows);
    }

    private void studentCounts(StudentCountView... views) {
        List<StudentCountView> rows = List.of(views);
        lenient().when(memberRepository.countStudentsByClassroomIds(any())).thenReturn(rows);
    }

    private void activeSessions(LiveSession... sessions) {
        List<LiveSession> rows = List.of(sessions);
        lenient().when(liveSessionRepository.findOpenByClassroomIds(any())).thenReturn(rows);
    }

    private void publishedCounts(PublishedCountView... views) {
        List<PublishedCountView> rows = List.of(views);
        lenient().when(assignmentRepository.countPublishedByClassroomIds(any())).thenReturn(rows);
    }

    private void submitters(AssignmentSubmitterView... views) {
        List<AssignmentSubmitterView> rows = List.of(views);
        lenient().when(submissionRepository.countSubmittersByClassroomIds(any())).thenReturn(rows);
    }

    private ClassroomMember membership(Long classroomId, String name) {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(classroomId);
        lenient().when(classroom.getName()).thenReturn(name);
        lenient().when(classroom.getAlias()).thenReturn("별칭");
        lenient().when(classroom.getGrades()).thenReturn(java.util.Set.of((short) 2));
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getClassroom()).thenReturn(classroom);
        lenient().when(member.getRole()).thenReturn(ClassroomRole.OWNER);
        return member;
    }

    private StudentCountView count(Long classroomId, long students) {
        StudentCountView v = mock(StudentCountView.class);
        lenient().when(v.getClassroomId()).thenReturn(classroomId);
        lenient().when(v.getStudents()).thenReturn(students);
        return v;
    }

    private LiveSession session(Long id, Long classroomId) {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(classroomId);
        LiveSession session = mock(LiveSession.class);
        lenient().when(session.getId()).thenReturn(id);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        lenient().when(session.getStartedAt()).thenReturn(NOW);
        /* 응답이 "누가 열었는지"를 싣는다 — 없으면 카드를 만드는 쪽에서 터진다 */
        User starter = mock(User.class);
        lenient().when(starter.getId()).thenReturn(1L);
        lenient().when(starter.getName()).thenReturn("이선생");
        lenient().when(session.getStartedBy()).thenReturn(starter);
        return session;
    }

    private PublishedCountView published(Long classroomId, long assignments) {
        PublishedCountView v = mock(PublishedCountView.class);
        lenient().when(v.getClassroomId()).thenReturn(classroomId);
        lenient().when(v.getPublished()).thenReturn(assignments);
        return v;
    }

    private AssignmentSubmitterView submitter(Long classroomId, Long assignmentId, long submitters) {
        AssignmentSubmitterView v = mock(AssignmentSubmitterView.class);
        lenient().when(v.getClassroomId()).thenReturn(classroomId);
        lenient().when(v.getAssignmentId()).thenReturn(assignmentId);
        lenient().when(v.getSubmitters()).thenReturn(submitters);
        return v;
    }

    private AuthUser teacher() {
        return new AuthUser(1L, Role.TEACHER, "김선생");
    }
}
