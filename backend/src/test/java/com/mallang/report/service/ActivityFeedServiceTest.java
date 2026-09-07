package com.mallang.report.service;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ActivityDtos.ActivityItem;
import com.mallang.report.dto.ActivityDtos.ActivityType;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionHistoryView;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.FeedSubmissionView;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 학급 활동 피드 — S15P11A407-137
 *
 * <p>선생님 4 화면의 '오늘의 활동'은 API 가 아예 없었다(§11.3 #10).</p>
 *
 * <p>새 표를 두지 않고 이미 있는 데이터(수업·과제·제출·합류)에서 파생한다 — 쓰기 경로를
 * 건드리지 않으니 백필도 없고, 원본이 지워지면 피드도 자연히 맞는다. 대신 합치고
 * 시간순으로 세우는 일이 서비스 몫이라 여기서 그걸 검증한다.</p>
 */
@ExtendWith(MockitoExtension.class)
class ActivityFeedServiceTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long TEACHER_ID = 1L;
    private static final LocalDateTime T = LocalDateTime.of(2026, 8, 1, 9, 0);

    @Mock AssignmentAccessGuard accessGuard;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock AssignmentRepository assignmentRepository;
    @Mock SubmissionRepository submissionRepository;
    @Mock ClassroomMemberRepository memberRepository;

    private ActivityFeedService service;

    @BeforeEach
    void setUp() {
        service = new ActivityFeedService(accessGuard, liveSessionRepository,
                assignmentRepository, submissionRepository, memberRepository);
        lenient().when(accessGuard.requireMember(CLASSROOM_ID, TEACHER_ID))
                .thenReturn(ClassroomRole.OWNER);
    }

    @Test
    void mergesEverySourceIntoOneTimelineNewestFirst() {
        sessions(session(T.plusHours(1), null));            // 09:00+1h 시작, 진행중
        assignments(assignment(31L, "받아쓰기", T.plusHours(3)));
        submissions(submission("받아쓰기", "김민수", T.plusHours(4)));
        members(member("이영희", T.plusHours(2)));

        List<ActivityItem> feed = service.feed(teacher(), CLASSROOM_ID, 20);

        // 출처가 섞여도 하나의 시간순 목록이어야 한다 — 최근이 위
        assertThat(feed).extracting(ActivityItem::type).containsExactly(
                ActivityType.SUBMISSION_RECEIVED,
                ActivityType.ASSIGNMENT_PUBLISHED,
                ActivityType.STUDENT_JOINED,
                ActivityType.SESSION_STARTED);
    }

    @Test
    void endedSessionProducesTwoEntries() {
        sessions(session(T, T.plusHours(1)));
        assignments();
        submissions();
        members();

        List<ActivityItem> feed = service.feed(teacher(), CLASSROOM_ID, 20);

        // 시작과 종료는 서로 다른 사건이다 — 하나로 접으면 타임라인이 틀어진다
        assertThat(feed).extracting(ActivityItem::type).containsExactly(
                ActivityType.SESSION_ENDED, ActivityType.SESSION_STARTED);
    }

    @Test
    void ongoingSessionHasNoEndEntry() {
        sessions(session(T, null));
        assignments();
        submissions();
        members();

        assertThat(service.feed(teacher(), CLASSROOM_ID, 20))
                .extracting(ActivityItem::type)
                .containsExactly(ActivityType.SESSION_STARTED);
    }

    @Test
    void unpublishedAssignmentsNeverAppear() {
        sessions();
        assignments(assignment(31L, "초안 과제", null));
        submissions();
        members();

        // 초안은 학생에게 보이지도 않는다 — 피드에 뜨면 공개된 것처럼 읽힌다
        assertThat(service.feed(teacher(), CLASSROOM_ID, 20)).isEmpty();
    }

    @Test
    void limitCutsTheOldestEntries() {
        sessions();
        assignments();
        submissions(submission("과제", "학생1", T.plusHours(1)),
                submission("과제", "학생2", T.plusHours(2)),
                submission("과제", "학생3", T.plusHours(3)));
        members();

        List<ActivityItem> feed = service.feed(teacher(), CLASSROOM_ID, 2);

        assertThat(feed).hasSize(2);
        assertThat(feed.get(0).at()).isEqualTo(T.plusHours(3));
        assertThat(feed.get(1).at()).isEqualTo(T.plusHours(2));
    }

    @Test
    void studentCannotSeeTheTeacherDashboardFeed() {
        when(accessGuard.requireMember(CLASSROOM_ID, 20L)).thenReturn(ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service.feed(
                new AuthUser(20L, Role.STUDENT, "김민수"), CLASSROOM_ID, 20))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void sessions(SessionHistoryView... rows) {
        List<SessionHistoryView> list = List.of(rows);
        lenient().when(liveSessionRepository.findHistoryByClassroomId(CLASSROOM_ID))
                .thenReturn(list);
    }

    private void assignments(Assignment... rows) {
        List<Assignment> list = List.of(rows);
        lenient().when(assignmentRepository.findByClassroomIdOrderByCreatedAtDesc(CLASSROOM_ID))
                .thenReturn(list);
    }

    private void submissions(FeedSubmissionView... rows) {
        List<FeedSubmissionView> list = List.of(rows);
        lenient().when(submissionRepository.findRecentSubmissions(any(), any()))
                .thenReturn(list);
    }

    private void members(ClassroomMember... rows) {
        List<ClassroomMember> list = List.of(rows);
        lenient().when(memberRepository.findWithUserByClassroomId(CLASSROOM_ID)).thenReturn(list);
    }

    private SessionHistoryView session(LocalDateTime startedAt, LocalDateTime endedAt) {
        return new SessionHistoryView(99L, CLASSROOM_ID, "김선생", startedAt, endedAt);
    }

    private Assignment assignment(Long id, String title, LocalDateTime publishedAt) {
        Assignment a = mock(Assignment.class);
        lenient().when(a.getId()).thenReturn(id);
        lenient().when(a.getTitle()).thenReturn(title);
        lenient().when(a.getPublishedAt()).thenReturn(publishedAt);
        return a;
    }

    private FeedSubmissionView submission(String title, String student, LocalDateTime at) {
        FeedSubmissionView v = mock(FeedSubmissionView.class);
        lenient().when(v.getAssignmentId()).thenReturn(31L);
        lenient().when(v.getAssignmentTitle()).thenReturn(title);
        lenient().when(v.getStudentName()).thenReturn(student);
        lenient().when(v.getSubmittedAt()).thenReturn(at);
        return v;
    }

    private ClassroomMember member(String name, LocalDateTime joinedAt) {
        User user = mock(User.class);
        lenient().when(user.getId()).thenReturn(20L);
        lenient().when(user.getName()).thenReturn(name);
        ClassroomMember m = mock(ClassroomMember.class);
        lenient().when(m.getUser()).thenReturn(user);
        lenient().when(m.getRole()).thenReturn(ClassroomRole.STUDENT);
        lenient().when(m.getJoinedAt()).thenReturn(joinedAt);
        return m;
    }

    private AuthUser teacher() {
        return new AuthUser(TEACHER_ID, Role.TEACHER, "김선생");
    }
}
