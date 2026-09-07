package com.mallang.classroom.service;

import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.tutor.repository.AiTutorMemoryRepository;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 학급 나가기 (본인) — S15P11A407-137
 *
 * <p>지금까지 학급을 떠나는 길은 선생님이 내보내는 것뿐이었다(명세 §11.4). 본인이 잘못
 * 수락한 초대를 스스로 물릴 수 없어 선생님에게 부탁해야 했다.</p>
 *
 * <p>제외와 같은 정리를 하되 권한 기준만 다르다 — 관리자가 아니라 본인이다.</p>
 */
@ExtendWith(MockitoExtension.class)
class ClassroomLeaveTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long STUDENT_ID = 20L;

    @Mock ClassroomRepository classroomRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock AiTutorMemoryRepository tutorMemoryRepository;
    @InjectMocks ClassroomService service;

    @Test
    void studentLeavesTheClassroomAndTheirTeam() {
        ClassroomMember membership = member(ClassroomRole.STUDENT);
        when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.of(membership));

        service.leave(student(), CLASSROOM_ID);

        // 팀 소속은 행을 지운다 — 남기면 재등록이 유니크 제약에 걸린다(제외와 같은 이유)
        verify(teamMemberRepository).deleteByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID);
        /*
          말랑이 기억도 지운다. 남기면 나중에 같은 학급에 다시 들어왔을 때 말랑이가 지난
          학기 대화를 기억하는 것처럼 군다 — 처음 말을 거는데 "저번에 물어본 그거"라고 답한다.
          대화 기록(AiTutorMessage)은 지우지 않는다: 그건 선생님이 살펴본 안전 신호의 근거다.
        */
        verify(tutorMemoryRepository).deleteByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID);
        verify(memberRepository).delete(membership);
    }

    @Test
    void ownerCannotLeaveTheirOwnClassroom() {
        ClassroomMember membership = member(ClassroomRole.OWNER);
        when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.of(membership));

        // 나가면 주인 없는 학급이 남는다 — 이양하거나 삭제해야 한다
        assertThatThrownBy(() -> service.leave(student(), CLASSROOM_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("담당자");

        verify(memberRepository, never()).delete(membership);
    }

    @Test
    void nonMemberGets404() {
        when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.leave(student(), CLASSROOM_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원");
    }

    @Test
    void maintainerCanLeave() {
        ClassroomMember membership = member(ClassroomRole.MAINTAINER);
        when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.of(membership));

        // 부담임이 반을 떠나는 건 정상 흐름이다
        service.leave(student(), CLASSROOM_ID);

        verify(memberRepository).delete(membership);
    }

    private ClassroomMember member(ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        return member;
    }

    private AuthUser student() {
        return new AuthUser(STUDENT_ID, Role.STUDENT, "김민수");
    }
}
