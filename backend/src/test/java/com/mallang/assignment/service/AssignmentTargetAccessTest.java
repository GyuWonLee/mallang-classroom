package com.mallang.assignment.service;

import com.mallang.assignment.dto.AssignmentDtos.CreateAssignmentRequest;
import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.AssignmentPublishedNotifier;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 대상이 지정된 과제는 그 학생만 열람 가능 — 대상 아닌 학생이 id 로 직접 열면 막힌다(접근 제어).
 */
@ExtendWith(MockitoExtension.class)
class AssignmentTargetAccessTest {

    @Mock AssignmentRepository assignmentRepository;
    @Mock SubmissionRepository submissionRepository;
    @Mock UserRepository userRepository;
    @Mock AssignmentAccessGuard accessGuard;
    @Mock AssignmentPublishedNotifier publishedNotifier;
    @Mock AssignmentListAggregator listAggregator;

    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    private AssignmentService service() {
        return new AssignmentService(assignmentRepository, submissionRepository, userRepository,
                accessGuard, objectMapper, publishedNotifier, listAggregator);
    }

    @Test
    void studentCannotViewAssignmentTargetedToOthers() {
        AuthUser student = new AuthUser(20L, Role.STUDENT);
        Assignment a = mock(Assignment.class);
        Classroom classroom = mock(Classroom.class);
        when(classroom.getId()).thenReturn(10L);
        when(a.getClassroom()).thenReturn(classroom);
        when(a.isPublished()).thenReturn(true);
        when(a.isVisibleTo(eq(20L), any())).thenReturn(false); // 이 학생은 대상(학년·본인)이 아니다
        when(assignmentRepository.findById(7L)).thenReturn(Optional.of(a));
        when(accessGuard.requireMember(10L, 20L)).thenReturn(ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service().get(student, 7L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("공개된 과제가 아닙니다");
    }

    private CreateAssignmentRequest createRequest(Integer grade, List<Short> targetGrades,
                                                  List<Long> targetStudentIds) {
        return new CreateAssignmentRequest("받아쓰기", Subject.KOREAN, grade,
                AssignmentType.MULTIPLE_CHOICE, null, null,
                objectMapper.valueToTree(java.util.Map.of("problems", List.of())),
                null, false, targetGrades, targetStudentIds);
    }

    private Assignment saveAndCapture(CreateAssignmentRequest request) {
        AuthUser teacher = new AuthUser(1L, Role.TEACHER);
        when(accessGuard.requireManager(10L, 1L)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(1L)).thenReturn(mock(User.class));

        service().create(teacher, 10L, request);

        ArgumentCaptor<Assignment> captor = ArgumentCaptor.forClass(Assignment.class);
        org.mockito.Mockito.verify(assignmentRepository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void createDefaultsTargetGradeFromGradeWhenNoTargetsGiven() {
        // 1학년 문제인데 대상을 안 정하면 → 1학년으로 공개 한정 (다른 학년엔 안 보이게)
        Assignment saved = saveAndCapture(createRequest(1, null, null));

        assertThat(saved.getTargetGrades()).containsExactly((short) 1);
        assertThat(saved.getTargetStudentIds()).isEmpty();
    }

    @Test
    void createKeepsExplicitStudentTargetsWithoutAddingGrade() {
        // 학생을 콕 집으면 grade 로 학년을 덧붙이지 않는다 (명시한 대상을 존중)
        Assignment saved = saveAndCapture(createRequest(1, null, List.of(42L)));

        assertThat(saved.getTargetStudentIds()).containsExactly(42L);
        assertThat(saved.getTargetGrades()).isEmpty();
    }

    @Test
    void createWithoutGradeStaysWholeClass() {
        // 직접 작성 과제라 grade 가 없으면 → 대상 비움(학급 전체) 그대로
        Assignment saved = saveAndCapture(createRequest(null, null, null));

        assertThat(saved.getTargetGrades()).isEmpty();
        assertThat(saved.getTargetStudentIds()).isEmpty();
    }
}
