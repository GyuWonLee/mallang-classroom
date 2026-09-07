package com.mallang.session.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.AttendanceDtos.AttendanceResponse;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionHistoryView;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.session.repository.SessionParticipantRepository.AttendanceView;
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
 * 학생별 출석 — S15P11A407-137
 *
 * <p>LiveKit 웹훅이 SESSION_PARTICIPANT 에 계속 쌓고 있었는데 학생 단위로 꺼내는 길이 없어
 * 선생님 화면의 출석 막대를 못 그렸다. 재입장이 새 행으로 쌓이는 구조라 "몇 번 들어왔나"가
 * 아니라 "그 수업에 있었나"로 접어야 한다는 것이 여기 핵심이다.</p>
 */
@ExtendWith(MockitoExtension.class)
class SessionAttendanceServiceTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long STUDENT_ID = 20L;
    private static final Long TEACHER_ID = 1L;
    private static final LocalDateTime T9 = LocalDateTime.of(2026, 8, 1, 9, 0);

    @Mock AssignmentAccessGuard accessGuard;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock SessionParticipantRepository sessionParticipantRepository;

    private SessionAttendanceService service;

    @BeforeEach
    void setUp() {
        service = new SessionAttendanceService(
                accessGuard, liveSessionRepository, sessionParticipantRepository);
    }

    @Test
    void reportsWhichSessionsTheStudentAttended() {
        teacherViewing();
        // 수업 3개 중 1·3 참석, 2 결석
        sessions(session(101L, T9, T9.plusHours(1)),
                session(102L, T9.plusDays(1), T9.plusDays(1).plusHours(1)),
                session(103L, T9.plusDays(2), T9.plusDays(2).plusHours(1)));
        attendance(view(101L, T9, T9.plusMinutes(50)),
                view(103L, T9.plusDays(2), T9.plusDays(2).plusMinutes(30)));

        AttendanceResponse response = service.attendance(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.totalSessions()).isEqualTo(3);
        assertThat(response.attendedSessions()).isEqualTo(2);
        assertThat(response.attendanceRate()).isEqualTo(66); // 2/3
        assertThat(response.sessions()).hasSize(3);
        assertThat(response.sessions().get(0).sessionId()).isEqualTo(101L);
        assertThat(response.sessions().get(0).attended()).isTrue();
        assertThat(response.sessions().get(0).minutes()).isEqualTo(50);
        assertThat(response.sessions().get(1).attended()).isFalse();
        assertThat(response.sessions().get(1).joinedAt()).isNull();
        assertThat(response.sessions().get(1).minutes()).isZero();
    }

    @Test
    void collapsesRejoinsIntoOneAttendance() {
        teacherViewing();
        sessions(session(101L, T9, T9.plusHours(1)));
        // 끊겼다 다시 들어온 학생 — 행은 둘이지만 출석은 하나다
        attendance(view(101L, T9, T9.plusMinutes(20)),
                view(101L, T9.plusMinutes(30), T9.plusMinutes(50)));

        AttendanceResponse response = service.attendance(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.attendedSessions()).isEqualTo(1);
        assertThat(response.sessions()).hasSize(1);
        // 처음 들어온 시각과 마지막 나간 시각, 체류는 합계(20+20)
        assertThat(response.sessions().get(0).joinedAt()).isEqualTo(T9);
        assertThat(response.sessions().get(0).leftAt()).isEqualTo(T9.plusMinutes(50));
        assertThat(response.sessions().get(0).minutes()).isEqualTo(40);
    }

    @Test
    void ongoingAttendanceCountsUntilSessionEnd() {
        teacherViewing();
        sessions(session(101L, T9, T9.plusHours(1)));
        // leftAt 이 안 찍힌 행 — 수업이 끝났으면 종료 시각까지로 계산한다
        attendance(view(101L, T9, null));

        AttendanceResponse response = service.attendance(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.sessions().get(0).attended()).isTrue();
        assertThat(response.sessions().get(0).minutes()).isEqualTo(60);
        assertThat(response.sessions().get(0).leftAt()).isNull(); // 아직 안 찍힌 건 안 찍힌 대로
    }

    @Test
    void noSessionsYetIsZeroPercentNotDivideByZero() {
        teacherViewing();
        sessions();
        attendance();

        AttendanceResponse response = service.attendance(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.totalSessions()).isZero();
        assertThat(response.attendanceRate()).isZero();
        assertThat(response.sessions()).isEmpty();
    }

    @Test
    void studentCanSeeTheirOwnAttendance() {
        when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(ClassroomRole.STUDENT);
        sessions(session(101L, T9, T9.plusHours(1)));
        attendance(view(101L, T9, T9.plusMinutes(50)));

        AttendanceResponse response = service.attendance(
                new AuthUser(STUDENT_ID, Role.STUDENT, "김민수"), CLASSROOM_ID, STUDENT_ID);

        assertThat(response.attendedSessions()).isEqualTo(1);
    }

    @Test
    void studentCannotSeeAnotherStudentsAttendance() {
        when(accessGuard.requireMember(CLASSROOM_ID, 99L)).thenReturn(ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service.attendance(
                new AuthUser(99L, Role.STUDENT, "남의학생"), CLASSROOM_ID, STUDENT_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("본인 또는 학급 선생님");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void teacherViewing() {
        lenient().when(accessGuard.requireMember(CLASSROOM_ID, TEACHER_ID))
                .thenReturn(ClassroomRole.OWNER);
    }

    private void sessions(SessionHistoryView... sessions) {
        when(liveSessionRepository.findHistoryByClassroomId(CLASSROOM_ID))
                .thenReturn(List.of(sessions));
    }

    private void attendance(AttendanceView... views) {
        when(sessionParticipantRepository
                .findAttendanceByClassroomAndStudent(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(List.of(views));
    }

    private SessionHistoryView session(Long id, LocalDateTime startedAt, LocalDateTime endedAt) {
        return new SessionHistoryView(id, CLASSROOM_ID, "이선생", startedAt, endedAt);
    }

    private AttendanceView view(Long sessionId, LocalDateTime joinedAt, LocalDateTime leftAt) {
        AttendanceView v = mock(AttendanceView.class);
        lenient().when(v.getSessionId()).thenReturn(sessionId);
        lenient().when(v.getJoinedAt()).thenReturn(joinedAt);
        lenient().when(v.getLeftAt()).thenReturn(leftAt);
        return v;
    }

    private AuthUser teacher() {
        return new AuthUser(TEACHER_ID, Role.TEACHER, "김선생");
    }
}
