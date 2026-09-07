package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.PasswordResetResponse;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 학생 비밀번호 초기화 — S15P11A407-115 */
@ExtendWith(MockitoExtension.class)
class StudentServiceTest {

    private static final List<ClassroomRole> MANAGE_ROLES =
            List.of(ClassroomRole.OWNER, ClassroomRole.MAINTAINER);

    @Mock UserRepository userRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock StudentAccountIssuer studentAccountIssuer;
    @InjectMocks StudentService service;

    @Test
    void managerResetsPasswordAndGetsPlaintextOnce() {
        User student = student("dodam01");
        when(userRepository.findById(11L)).thenReturn(Optional.of(student));
        when(memberRepository.managesMember(1L, 11L, MANAGE_ROLES)).thenReturn(true);
        when(studentAccountIssuer.resetPassword(student)).thenReturn("kmp3rfxz");

        PasswordResetResponse response = service.resetPassword(teacher(1L), 11L);

        assertThat(response).isEqualTo(new PasswordResetResponse("dodam01", "kmp3rfxz"));
    }

    @Test
    void teacherOfAnotherClassroomIsRejected() {
        User student = student("dodam01");
        when(userRepository.findById(11L)).thenReturn(Optional.of(student));
        when(memberRepository.managesMember(99L, 11L, MANAGE_ROLES)).thenReturn(false);

        assertThatThrownBy(() -> service.resetPassword(teacher(99L), 11L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("관리자만");
        verify(studentAccountIssuer, never()).resetPassword(any());
    }

    @Test
    void teacherAccountCannotBeReset() {
        User anotherTeacher = mock(User.class);
        when(anotherTeacher.isTeacher()).thenReturn(true);
        when(userRepository.findById(2L)).thenReturn(Optional.of(anotherTeacher));

        assertThatThrownBy(() -> service.resetPassword(teacher(1L), 2L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학생 계정만");
        // 권한 조회까지 가지 않고 막힌다
        verify(memberRepository, never()).managesMember(anyLong(), anyLong(), any());
    }

    @Test
    void unknownStudentIs404() {
        when(userRepository.findById(404L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.resetPassword(teacher(1L), 404L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학생을 찾을 수 없습니다");
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private User student(String username) {
        User user = mock(User.class);
        lenient().when(user.isTeacher()).thenReturn(false);
        lenient().when(user.getUsername()).thenReturn(username);
        return user;
    }
}
