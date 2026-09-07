package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.ClassroomResponse;
import com.mallang.classroom.dto.ClassroomDtos.UpdateClassroomRequest;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 학급 수정·삭제 + 구성원 제외 — S15P11A407-111 */
@ExtendWith(MockitoExtension.class)
class ClassroomManageTest {

    @Mock ClassroomRepository classroomRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock UserRepository userRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock AliasGenerator aliasGenerator;
    @Mock StudentCsvParser csvParser;
    @Mock StudentAccountIssuer studentAccountIssuer;
    @Mock com.mallang.assignment.repository.AssignmentRepository assignmentRepository;
    @Mock com.mallang.submission.repository.SubmissionRepository submissionRepository;
    @Mock com.mallang.tutor.repository.AiTutorMemoryRepository tutorMemoryRepository;

    private ClassroomService service;

    @BeforeEach
    void setUp() {
        service = new ClassroomService(classroomRepository, memberRepository, liveSessionRepository,
                userRepository, teamMemberRepository, aliasGenerator, csvParser,
                studentAccountIssuer, assignmentRepository, submissionRepository, event -> { },
                tutorMemoryRepository);
    }

    @Test
    void managerRenamesClassroom() {
        Classroom classroom = classroom();
        ClassroomMember maintainer = member(ClassroomRole.MAINTAINER);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(maintainer));

        ClassroomResponse response =
                service.updateClassroom(user(1L), 7L, new UpdateClassroomRequest("4학년 1반", null));

        verify(classroom).rename("4학년 1반");
        assertThat(response.myRole()).isEqualTo("MAINTAINER");
    }

    @Test
    void studentCannotRenameClassroom() {
        Classroom classroom = classroom();
        ClassroomMember student = member(ClassroomRole.STUDENT);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 5L)).thenReturn(Optional.of(student));

        assertThatThrownBy(() -> service.updateClassroom(user(5L), 7L,
                new UpdateClassroomRequest("바꿔치기", null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("관리자");
        verify(classroom, never()).rename(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void ownerDeletesClassroomWithMembershipsAndStudentAccounts() {
        Classroom classroom = classroom();
        User teacherAccount = account(1L);
        User studentAccount = account(11L);
        ClassroomMember owner = memberWithUser(ClassroomRole.OWNER, teacherAccount);
        ClassroomMember student = memberWithUser(ClassroomRole.STUDENT, studentAccount);
        java.util.List<ClassroomMember> roster = java.util.List.of(owner, student);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(owner));
        when(memberRepository.findWithUserByClassroomId(7L)).thenReturn(roster);
        when(memberRepository.findUserIdsBelongingToOtherClassrooms(java.util.List.of(11L), 7L))
                .thenReturn(java.util.List.of());

        service.deleteClassroom(user(1L), 7L);

        // 참조하는 쪽부터 지워야 flush 때 터지지 않는다 (S15P11A407-122)
        InOrder order = inOrder(teamMemberRepository, memberRepository, userRepository,
                classroomRepository);
        order.verify(teamMemberRepository).deleteByClassroomId(7L);
        order.verify(memberRepository).deleteAll(roster);
        // 학생 계정만 사라진다 — 선생님 계정은 다른 학급·본인 로그인이 걸려 있다
        order.verify(userRepository).deleteAll(java.util.List.of(studentAccount));
        order.verify(classroomRepository).delete(classroom);
    }

    @Test
    void studentBelongingToAnotherClassroomKeepsAccount() {
        Classroom classroom = classroom();
        User owner1 = account(1L);
        User shared = account(11L);
        ClassroomMember owner = memberWithUser(ClassroomRole.OWNER, owner1);
        ClassroomMember student = memberWithUser(ClassroomRole.STUDENT, shared);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(owner));
        when(memberRepository.findWithUserByClassroomId(7L))
                .thenReturn(java.util.List.of(owner, student));
        // 다른 학급에도 적이 있는 계정
        when(memberRepository.findUserIdsBelongingToOtherClassrooms(java.util.List.of(11L), 7L))
                .thenReturn(java.util.List.of(11L));

        service.deleteClassroom(user(1L), 7L);

        // 남의 학급이 망가지지 않게 계정은 남긴다
        verify(userRepository).deleteAll(java.util.List.of());
    }

    @Test
    void maintainerCannotDeleteClassroom() {
        Classroom classroom = classroom();
        ClassroomMember maintainer = member(ClassroomRole.MAINTAINER);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 2L)).thenReturn(Optional.of(maintainer));

        assertThatThrownBy(() -> service.deleteClassroom(user(2L), 7L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("OWNER만");
        verify(classroomRepository, never()).delete(classroom);
    }

    @Test
    void removingStudentAlsoClearsTeamMembership() {
        ClassroomMember owner = member(ClassroomRole.OWNER);
        ClassroomMember student = member(ClassroomRole.STUDENT);
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(owner));
        when(memberRepository.findByClassroomIdAndUserId(7L, 11L)).thenReturn(Optional.of(student));

        service.removeMember(user(1L), 7L, 11L);

        // 팀 소속을 먼저 지워야 재등록 시 uq_team_member_classroom_user 에 걸리지 않는다
        InOrder order = inOrder(teamMemberRepository, memberRepository);
        order.verify(teamMemberRepository).deleteByClassroomIdAndUserId(7L, 11L);
        order.verify(memberRepository).delete(student);
    }

    @Test
    void ownerCannotBeRemoved() {
        ClassroomMember owner = member(ClassroomRole.OWNER);
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(owner));

        assertThatThrownBy(() -> service.removeMember(user(1L), 7L, 1L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("OWNER는 제외할 수 없습니다");
        verify(teamMemberRepository, never()).deleteByClassroomIdAndUserId(7L, 1L);
    }

    @Test
    void removingUnknownMemberIs404() {
        ClassroomMember owner = member(ClassroomRole.OWNER);
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(owner));
        when(memberRepository.findByClassroomIdAndUserId(7L, 99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.removeMember(user(1L), 7L, 99L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원을 찾을 수 없습니다");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser user(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private Classroom classroom() {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(7L);
        lenient().when(classroom.getName()).thenReturn("3학년 2반");
        lenient().when(classroom.getAlias()).thenReturn("dodam");
        return classroom;
    }

    private ClassroomMember member(ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        return member;
    }

    private ClassroomMember memberWithUser(ClassroomRole role, User user) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        lenient().when(member.getUser()).thenReturn(user);
        return member;
    }

    private User account(Long id) {
        User user = mock(User.class);
        lenient().when(user.getId()).thenReturn(id);
        return user;
    }
}
