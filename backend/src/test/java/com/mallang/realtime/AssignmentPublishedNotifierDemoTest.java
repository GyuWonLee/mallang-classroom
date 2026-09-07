package com.mallang.realtime;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.service.AssignmentTargetResolver;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomMemberRepository.StudentGradeView;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 인프라(DB·Redis·프론트) 없이 "과제 공개 → 학생들에게 나가는 실시간 알림"을 눈으로 보는 데모.
 * 실행: .\gradlew.bat test --tests "*AssignmentPublishedNotifierDemoTest" --info
 *
 * <p>대상이 아닌 아이에게는 가지 않는다는 점을 함께 보여준다 — 1학년 과제를 3학년 아이가
 * 알림으로 받고 활동지를 열었는데 아무것도 없던 일이 있었다.</p>
 */
class AssignmentPublishedNotifierDemoTest {

    @Test
    void showsWhatStudentsReceiveWhenTeacherPublishes() {
        ClassroomMemberRepository memberRepository = mock(ClassroomMemberRepository.class);
        SimpMessagingTemplate messagingTemplate = mock(SimpMessagingTemplate.class);

        // 학급 10: 1학년 두 명(101·102), 3학년 한 명(103), 담당 선생님 한 명(9)
        // view() 가 안에서 스터빙하므로 when(...) 밖에서 먼저 만든다
        List<StudentGradeView> roster = List.of(
                view(101L, (short) 1), view(102L, (short) 1), view(103L, (short) 3));
        when(memberRepository.findStudentGrades(eq(10L), any())).thenReturn(roster);
        when(memberRepository.findUserIdsByClassroomIdAndRoleIn(eq(10L), any()))
                .thenReturn(List.of(9L));

        // 1학년에게만 나가는 과제
        Assignment assignment = mock(Assignment.class);
        when(assignment.getId()).thenReturn(55L);
        when(assignment.isVisibleTo(any(), any()))
                .thenAnswer(inv -> Short.valueOf((short) 1).equals(inv.getArgument(1)));

        AssignmentPublishedNotifier notifier = new AssignmentPublishedNotifier(
                memberRepository, new AssignmentTargetResolver(memberRepository), messagingTemplate);

        System.out.println("\n===== 선생님이 1학년 과제(id=55)를 '공개'로 바꾼 순간 =====");
        System.out.println("(PATCH /assignments/55  { publish: true }  — 초안→공개 첫 전환)");
        notifier.notifyPublished(10L, assignment);

        ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> dest = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        // 1학년 둘 + 선생님 하나 = 셋. 3학년 아이는 빠진다
        verify(messagingTemplate, times(3))
                .convertAndSendToUser(user.capture(), dest.capture(), payload.capture());

        System.out.println("→ 받는 사람 " + user.getAllValues().size() + "명 (3학년 103 은 제외):");
        for (int i = 0; i < user.getAllValues().size(); i++) {
            System.out.printf("   user=%s  구독경로=/user%s%n   payload=%s%n",
                    user.getAllValues().get(i), dest.getAllValues().get(i),
                    payload.getAllValues().get(i));
        }
        System.out.println("→ 프론트는 이 알림을 받고 GET /classrooms/10/assignments 를 다시 호출(목록 갱신)");
        System.out.println("================================================\n");
    }

    private StudentGradeView view(Long studentId, Short grade) {
        StudentGradeView v = mock(StudentGradeView.class);
        when(v.getStudentId()).thenReturn(studentId);
        when(v.getGrade()).thenReturn(grade);
        return v;
    }
}
