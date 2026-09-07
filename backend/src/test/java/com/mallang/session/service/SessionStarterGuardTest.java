package com.mallang.session.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SessionStarterGuardTest {

    @Mock LiveSessionRepository liveSessionRepository;

    private SessionStarterGuard guard;

    @BeforeEach
    void setUp() {
        guard = new SessionStarterGuard(liveSessionRepository);
    }

    @Test
    void sessionStarterIsAllowed() {
        openSessionStartedBy(1L);

        guard.requireStarter(10L, teacher(1L));
    }

    @Test
    void anotherTeacherIsRejected() {
        openSessionStartedBy(1L);

        assertThatThrownBy(() -> guard.requireStarter(10L, teacher(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    @Test
    void studentIsRejectedEvenWithSameUserId() {
        openSessionStartedBy(1L);

        assertThatThrownBy(() -> guard.requireStarter(
                10L, new AuthUser(1L, Role.STUDENT, "학생")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    @Test
    void endedSessionIsRejected() {
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> guard.requireStarter(10L, teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("진행 중인 수업");
    }

    @Test
    void classroomGradeIsAllowedForTopic() {
        LiveSession session = openSessionStartedBy(1L);
        Classroom classroom = mock(Classroom.class);
        when(session.getClassroom()).thenReturn(classroom);
        when(classroom.accepts((short) 5)).thenReturn(true);

        guard.requireStarterForGrade(10L, 5, teacher(1L));
    }

    @Test
    void gradeOutsideElementaryRangeIsRejected() {
        openSessionStartedBy(1L);

        assertThatThrownBy(() -> guard.requireStarterForGrade(10L, 7, teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("1~6");
    }

    @Test
    void gradeOutsideClassroomIsRejected() {
        LiveSession session = openSessionStartedBy(1L);
        Classroom classroom = mock(Classroom.class);
        when(session.getClassroom()).thenReturn(classroom);
        when(classroom.accepts((short) 6)).thenReturn(false);

        assertThatThrownBy(() -> guard.requireStarterForGrade(10L, 6, teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학급에 포함되지 않은");
    }

    private LiveSession openSessionStartedBy(Long teacherId) {
        LiveSession session = mock(LiveSession.class);
        User teacher = mock(User.class);
        lenient().when(teacher.getId()).thenReturn(teacherId);
        lenient().when(session.getStartedBy()).thenReturn(teacher);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L))
                .thenReturn(Optional.of(session));
        return session;
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }
}
