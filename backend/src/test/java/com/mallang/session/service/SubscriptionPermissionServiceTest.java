package com.mallang.session.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.repository.ClassroomMemberRepository;
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
import org.springframework.security.access.AccessDeniedException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SubscriptionPermissionServiceTest {

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;

    private SubscriptionPermissionService service;

    @BeforeEach
    void setUp() {
        service = new SubscriptionPermissionService(liveSessionRepository,
                classroomMemberRepository);
    }

    @Test
    void sessionStarterCanSubscribe() {
        stubMembership(1L);

        service.checkSessionAccess(10L, teacher(1L));
    }

    @Test
    void anotherClassroomTeacherCannotSubscribe() {
        stubMembership(2L);

        assertThatThrownBy(() -> service.checkSessionAccess(10L, teacher(2L)))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("수업을 시작한 선생님");
    }

    @Test
    void classroomStudentCanSubscribe() {
        stubMembership(11L);

        service.checkSessionAccess(10L, new AuthUser(11L, Role.STUDENT, "학생"));
    }

    private void stubMembership(Long memberId) {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        User starter = mock(User.class);
        when(session.getClassroom()).thenReturn(classroom);
        when(classroom.getId()).thenReturn(2L);
        lenient().when(session.getStartedBy()).thenReturn(starter);
        lenient().when(starter.getId()).thenReturn(1L);
        when(liveSessionRepository.findById(10L)).thenReturn(Optional.of(session));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, memberId))
                .thenReturn(Optional.of(mock(ClassroomMember.class)));
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "선생님");
    }
}
