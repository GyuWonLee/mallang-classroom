package com.mallang.realtime;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.service.AssignmentTargetResolver;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomMemberRepository.StudentGradeView;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 과제 공개 알림 대상 — <b>그 과제를 받는 학생</b>과 학급 선생님들.
 *
 * <p>예전에는 학급 구성원 전원에게 보냈다. 과제는 학년·학생을 골라 나가는데 알림만 모두에게
 * 간 것이라, 1학년 아이가 "새 과제가 도착했어요"를 받고 활동지를 열었는데 아무것도 없는 일이
 * 생겼다(3학년 과제였다). 알림이 거짓말을 하면 다음 알림도 안 믿게 된다.</p>
 */
@ExtendWith(MockitoExtension.class)
class AssignmentPublishedNotifierTest {

    private static final Long CLASSROOM_ID = 10L;

    @Mock ClassroomMemberRepository memberRepository;
    @Mock SimpMessagingTemplate messagingTemplate;

    private AssignmentPublishedNotifier notifier() {
        /* resolver 는 목이 아니라 진짜다 — 여기서 지키려는 것이 그 대상 판정이다 */
        return new AssignmentPublishedNotifier(
                memberRepository, new AssignmentTargetResolver(memberRepository), messagingTemplate);
    }

    @Test
    void sendsOnlyToStudentsTheAssignmentWasGivenTo() {
        // 학급 학생 셋(1학년 101·102, 3학년 103) 중 대상은 1학년 둘
        roster(view(101L, (short) 1), view(102L, (short) 1), view(103L, (short) 3));
        teachers(9L);
        Assignment assignment = assignmentTargeting(101L, 102L);

        notifier().notifyPublished(CLASSROOM_ID, assignment);

        verify(messagingTemplate).convertAndSendToUser(eq("101"), eq("/sub/notifications"), any());
        verify(messagingTemplate).convertAndSendToUser(eq("102"), eq("/sub/notifications"), any());
        // 3학년 아이는 이 과제를 볼 수 없다 — 알림도 가면 안 된다
        verify(messagingTemplate, never())
                .convertAndSendToUser(eq("103"), anyString(), any(Object.class));
    }

    /** 선생님은 대상이 아니어도 받는다 — 무엇이 나갔는지가 그 자체로 정보다 */
    @Test
    void teachersAreNotifiedEvenWhenNotTargets() {
        roster(view(101L, (short) 1));
        teachers(9L);
        Assignment assignment = assignmentTargeting(101L);

        notifier().notifyPublished(CLASSROOM_ID, assignment);

        verify(messagingTemplate).convertAndSendToUser(eq("9"), eq("/sub/notifications"), any());
    }

    @Test
    void payloadCarriesClassroomAndAssignment() {
        roster(view(101L, (short) 1));
        teachers();
        Assignment assignment = assignmentTargeting(101L);

        notifier().notifyPublished(CLASSROOM_ID, assignment);

        ArgumentCaptor<StompEnvelope> captor = ArgumentCaptor.forClass(StompEnvelope.class);
        verify(messagingTemplate).convertAndSendToUser(eq("101"), eq("/sub/notifications"),
                captor.capture());
        StompEnvelope env = captor.getValue();
        assertThat(env.type()).isEqualTo(StompEventType.ASSIGNMENT_PUBLISHED);
        assertThat(env.payload())
                .isEqualTo(Map.of("classroomId", CLASSROOM_ID, "assignmentId", 55L));
    }

    @Test
    void sendsNothingWhenNobodyIsTargeted() {
        roster();
        teachers();
        Assignment assignment = assignmentTargeting();

        notifier().notifyPublished(CLASSROOM_ID, assignment);

        verifyNoInteractions(messagingTemplate);
    }

    /** 같은 사람이 두 번 잡혀도 한 번만 간다 (대상 학생이면서 선생님일 수는 없지만 집합으로 지운다) */
    @Test
    void doesNotSendTwiceToTheSamePerson() {
        roster(view(101L, (short) 1));
        teachers(101L);
        Assignment assignment = assignmentTargeting(101L);

        notifier().notifyPublished(CLASSROOM_ID, assignment);

        verify(messagingTemplate, times(1))
                .convertAndSendToUser(eq("101"), anyString(), any(Object.class));
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void roster(StudentGradeView... views) {
        lenient().when(memberRepository.findStudentGrades(eq(CLASSROOM_ID), any()))
                .thenReturn(List.of(views));
    }

    private void teachers(Long... ids) {
        lenient().when(memberRepository.findUserIdsByClassroomIdAndRoleIn(eq(CLASSROOM_ID), any()))
                .thenReturn(List.of(ids));
    }

    private StudentGradeView view(Long studentId, Short grade) {
        StudentGradeView v = mock(StudentGradeView.class);
        lenient().when(v.getStudentId()).thenReturn(studentId);
        lenient().when(v.getGrade()).thenReturn(grade);
        return v;
    }

    /** 지목한 학생에게만 보이는 과제 (판정은 엔티티가 한다 — 여기서는 그 답만 흉내낸다) */
    private Assignment assignmentTargeting(Long... studentIds) {
        List<Long> targets = new ArrayList<>(List.of(studentIds));
        Assignment a = mock(Assignment.class);
        lenient().when(a.getId()).thenReturn(55L);
        lenient().when(a.isVisibleTo(any(), any()))
                .thenAnswer(inv -> targets.contains(inv.getArgument(0)));
        return a;
    }
}
