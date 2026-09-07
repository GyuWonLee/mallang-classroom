package com.mallang.assignment.service;

import com.mallang.assignment.dto.AssignmentDtos.UpdateAssignmentRequest;
import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import tools.jackson.databind.JsonNode;
import com.mallang.realtime.AssignmentPublishedNotifier;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * PATCH /assignments/{id} 의 publish 전환 시 통지 규칙 검증 (S15P11A407-134):
 * 초안→공개로 '처음' 바뀔 때만 발행하고, 이미 공개/비공개 전환에는 발행하지 않는다.
 */
@ExtendWith(MockitoExtension.class)
class AssignmentPublishNotifyTest {

    @Mock AssignmentRepository assignmentRepository;
    @Mock SubmissionRepository submissionRepository;
    @Mock UserRepository userRepository;
    @Mock AssignmentAccessGuard accessGuard;
    @Mock AssignmentPublishedNotifier publishedNotifier;
    @Mock AssignmentListAggregator listAggregator;

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private final AuthUser teacher = new AuthUser(1L, Role.TEACHER);

    private AssignmentService service() {
        return new AssignmentService(assignmentRepository, submissionRepository, userRepository,
                accessGuard, objectMapper, publishedNotifier, listAggregator);
    }

    @Test
    void notifiesWhenDraftBecomesPublished() {
        Assignment a = assignmentMock(false, true); // 전: 초안 → 후: 공개
        when(assignmentRepository.findById(7L)).thenReturn(Optional.of(a));

        service().update(teacher, 7L, new UpdateAssignmentRequest(null, null, true, null));

        verify(publishedNotifier).notifyPublished(10L, a);
    }

    @Test
    void doesNotNotifyWhenAlreadyPublished() {
        Assignment a = assignmentMock(true, true); // 이미 공개된 과제를 다시 PATCH
        when(assignmentRepository.findById(7L)).thenReturn(Optional.of(a));

        service().update(teacher, 7L, new UpdateAssignmentRequest("새 제목", null, true, null));

        verify(publishedNotifier, never()).notifyPublished(anyLong(), any());
    }

    @Test
    void doesNotNotifyOnUnpublish() {
        Assignment a = assignmentMock(true, false); // 공개 → 비공개
        when(assignmentRepository.findById(7L)).thenReturn(Optional.of(a));

        service().update(teacher, 7L, new UpdateAssignmentRequest(null, null, false, null));

        verify(publishedNotifier, never()).notifyPublished(anyLong(), any());
    }

    @Test
    void editsProblemsWhenDraft() throws Exception {
        Assignment a = assignmentMock(false, false); // 초안 유지 — 문제만 교체
        when(assignmentRepository.findById(7L)).thenReturn(Optional.of(a));
        JsonNode content = objectMapper.readTree("{\"problems\":[{\"no\":1,\"prompt\":\"새 문제\"}]}");

        service().update(teacher, 7L, new UpdateAssignmentRequest(null, null, null, content));

        // 초안이면 문제(content)를 통째로 교체한다
        verify(a).updateContent(argThat(json -> json.contains("problems") && json.contains("새 문제")));
    }

    @Test
    void rejectsProblemEditWhenAlreadyPublished() throws Exception {
        Assignment a = mock(Assignment.class);
        when(a.isPublished()).thenReturn(true); // 이미 공개된 과제
        Classroom classroom = mock(Classroom.class);
        when(classroom.getId()).thenReturn(10L);
        when(a.getClassroom()).thenReturn(classroom);
        when(assignmentRepository.findById(7L)).thenReturn(Optional.of(a));
        JsonNode content = objectMapper.readTree("{\"problems\":[]}");

        // 공개된 과제의 문제를 바꾸면 이미 푼 학생과 어긋나므로 409로 막는다
        org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                        service().update(teacher, 7L, new UpdateAssignmentRequest(null, null, null, content)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("공개된 과제");
        verify(a, never()).updateContent(anyString());
    }

    // isPublished()가 전환 전→후 순서로 반환하도록 + toResponse가 통과하도록 최소 스텁
    private Assignment assignmentMock(boolean before, boolean after) {
        Assignment a = mock(Assignment.class);
        when(a.isPublished()).thenReturn(before, after);
        when(a.getId()).thenReturn(7L);
        Classroom classroom = mock(Classroom.class);
        when(classroom.getId()).thenReturn(10L);
        when(a.getClassroom()).thenReturn(classroom);
        User creator = mock(User.class);
        when(creator.getId()).thenReturn(1L);
        when(a.getCreatedBy()).thenReturn(creator);
        when(a.getContent()).thenReturn("{}");
        return a;
    }
}
