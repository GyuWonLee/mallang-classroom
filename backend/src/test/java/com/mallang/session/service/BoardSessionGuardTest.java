package com.mallang.session.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.repository.ClassroomMemberRepository;
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
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.lenient;

@ExtendWith(MockitoExtension.class)
class BoardSessionGuardTest {

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock StringRedisTemplate redis;
    @Mock SetOperations<String, String> setOperations;

    private BoardSessionGuard guard;

    @BeforeEach
    void setUp() {
        guard = new BoardSessionGuard(liveSessionRepository, classroomMemberRepository, redis);
        lenient().when(redis.opsForSet()).thenReturn(setOperations);
    }

    @Test
    void sessionMemberIsAllowed() {
        openSessionInClassroom(3L);
        when(classroomMemberRepository.findByClassroomIdAndUserId(3L, 11L))
                .thenReturn(Optional.of(mock(ClassroomMember.class)));

        guard.requireMember(10L, student(11L));

        verify(classroomMemberRepository).findByClassroomIdAndUserId(3L, 11L);
        verify(setOperations).add(SessionRedisKeys.boardMembers(10L), "11");
    }

    @Test
    void cachedSessionMemberSkipsDatabaseQueries() {
        when(setOperations.isMember(SessionRedisKeys.boardMembers(10L), "11"))
                .thenReturn(true);

        guard.requireMember(10L, student(11L));

        verifyNoInteractions(liveSessionRepository, classroomMemberRepository);
        verify(setOperations, never()).add(SessionRedisKeys.boardMembers(10L), "11");
    }

    @Test
    void unrelatedTeacherIsRejected() {
        openSessionInClassroom(3L);
        when(classroomMemberRepository.findByClassroomIdAndUserId(3L, 1L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> guard.requireTeacher(10L, teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학급 구성원");
    }

    @Test
    void anotherTeacherInClassroomCannotUseBoard() {
        openSessionInClassroom(3L);

        assertThatThrownBy(() -> guard.requireTeacher(10L, teacher(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    @Test
    void studentCannotClearBoard() {
        assertThatThrownBy(() -> guard.requireTeacher(10L, student(11L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");
    }

    @Test
    void endedSessionIsRejected() {
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> guard.requireMember(10L, teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("진행 중인 수업");
    }

    private void openSessionInClassroom(Long classroomId) {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        lenient().when(classroom.getId()).thenReturn(classroomId);
        User starter = mock(User.class);
        lenient().when(starter.getId()).thenReturn(1L);
        lenient().when(session.getStartedBy()).thenReturn(starter);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(10L))
                .thenReturn(Optional.of(session));
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "선생님");
    }

    private AuthUser student(Long id) {
        return new AuthUser(id, Role.STUDENT, "학생");
    }
}
