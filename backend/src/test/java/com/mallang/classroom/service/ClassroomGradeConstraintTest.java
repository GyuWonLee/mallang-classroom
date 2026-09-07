package com.mallang.classroom.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.team.service.TeamAssignmentService;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 학급 담당 학년 제약 (S15P11A407-124).
 * 학생 발급 경로(단건·CSV·초대)가 모두 StudentAccountIssuer.enroll 을 지나므로 여기서 한 번만 막는다.
 */
@ExtendWith(MockitoExtension.class)
class ClassroomGradeConstraintTest {

    @Mock UserRepository userRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock TeamAssignmentService teamAssignmentService;
    @Mock PasswordEncoder passwordEncoder;
    @InjectMocks StudentAccountIssuer issuer;

    @Test
    void acceptsStudentWhoseGradeIsInClassroom() {
        Classroom classroom = Classroom.create("3·4학년반", "dodam", List.of((short) 3, (short) 4));
        stubAccountCreation();

        assertThatCode(() -> issuer.enroll(classroom, "김민수", "싸피초", (short) 4, "pw"))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsStudentFromAnotherGrade() {
        Classroom classroom = Classroom.create("3·4학년반", "dodam", List.of((short) 3, (short) 4));

        assertThatThrownBy(() -> issuer.enroll(classroom, "김민수", "싸피초", (short) 5, "pw"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("3·4학년만");
        // 거부된 학생은 계정도 팀도 만들어지지 않아야 한다
        verify(userRepository, never()).save(any());
        verify(teamAssignmentService, never()).assignToGradeTeam(any(), any());
    }

    @Test
    void classroomWithoutGradesAcceptsAnyone() {
        // 학년 도입 전에 만들어진 학급 — 제약을 걸면 기존 학급의 학생 등록이 막힌다
        Classroom legacy = Classroom.create("옛 학급", "saebom", List.of());
        stubAccountCreation();

        assertThatCode(() -> issuer.enroll(legacy, "김민수", "싸피초", (short) 6, "pw"))
                .doesNotThrowAnyException();
    }

    @Test
    void gradesAreStoredInAscendingOrderForDisplay() {
        Classroom classroom = Classroom.create("반", "dodam", List.of((short) 4, (short) 3));

        // 화면에 "3·4학년"으로 보이도록 입력 순서와 무관하게 정렬해 둔다
        assertThat(classroom.getGrades()).containsExactly((short) 3, (short) 4);
    }

    @Test
    void replacingGradesSwapsTheWholeSet() {
        Classroom classroom = Classroom.create("반", "dodam", List.of((short) 1));

        classroom.replaceGrades(List.of((short) 5, (short) 2));

        assertThat(classroom.getGrades()).containsExactly((short) 2, (short) 5);
        assertThat(classroom.accepts((short) 1)).isFalse();
    }

    private void stubAccountCreation() {
        User student = mock(User.class);
        lenient().when(userRepository.countByUsernamePrefixIncludingDeleted(anyString())).thenReturn(0L);
        lenient().when(userRepository.existsByUsernameIncludingDeleted(anyString())).thenReturn(false);
        lenient().when(passwordEncoder.encode(anyString())).thenReturn("hashed");
        lenient().when(userRepository.save(any(User.class))).thenReturn(student);
    }
}
