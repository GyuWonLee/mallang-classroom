package com.mallang.invite.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.classroom.service.StudentAccountIssuer;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.invite.dto.InviteDtos.AcceptInviteRequest;
import com.mallang.invite.dto.InviteDtos.AcceptInviteResponse;
import com.mallang.invite.dto.InviteDtos.CreateInviteRequest;
import com.mallang.invite.dto.InviteDtos.InviteResponse;
import com.mallang.invite.entity.Invite;
import com.mallang.invite.entity.InviteType;
import com.mallang.invite.repository.InviteRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyShort;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 초대 발급·수락 — S15P11A407-112 */
@ExtendWith(MockitoExtension.class)
class InviteServiceTest {

    @Mock InviteRepository inviteRepository;
    @Mock ClassroomRepository classroomRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock UserRepository userRepository;
    @Mock StudentAccountIssuer studentAccountIssuer;
    @InjectMocks InviteService service;

    private Classroom classroom;

    @BeforeEach
    void setUp() {
        classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(7L);
        lenient().when(classroom.getName()).thenReturn("3학년 2반");
    }

    @Test
    void studentInviteDefaultsToThirtyUsesAndSafeCharset() {
        managerIs(1L, ClassroomRole.OWNER);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(inviteRepository.existsByCode(anyString())).thenReturn(false);
        when(inviteRepository.save(any(Invite.class))).thenAnswer(inv -> inv.getArgument(0));

        InviteResponse response = service.create(teacher(1L), 7L,
                new CreateInviteRequest(InviteType.STUDENT, null, null));

        assertThat(response.maxUses()).isEqualTo(30);
        assertThat(response.usedCount()).isZero();
        // 혼동 문자(0,O,1,I,L)가 섞이면 저학년이 옮겨 적다 실패한다
        assertThat(response.code()).hasSize(6).doesNotContainAnyWhitespaces()
                .matches("[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}");
    }

    @Test
    void teacherInviteIsReusableUntilItExpires() {
        managerIs(1L, ClassroomRole.OWNER);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(inviteRepository.existsByCode(anyString())).thenReturn(false);
        when(inviteRepository.save(any(Invite.class))).thenAnswer(inv -> inv.getArgument(0));

        InviteResponse response = service.create(teacher(1L), 7L,
                new CreateInviteRequest(InviteType.TEACHER, null, null));

        /*
          선생님 초대는 **횟수 제한이 없다**(0 = UNLIMITED). 예전에는 1회였는데, 한 명 더 부를
          때마다 링크를 새로 만들어야 했다 — 링크를 보내 놓고 그 사이 다른 선생님이 먼저 쓰면
          뒤에 온 사람은 "만료된 초대"를 본다. 통제는 만료 시각과 회수 버튼이 맡는다.
        */
        assertThat(response.maxUses()).isEqualTo(InviteType.UNLIMITED);
    }

    @Test
    void studentCannotCreateInvite() {
        managerIs(5L, ClassroomRole.STUDENT);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));

        assertThatThrownBy(() -> service.create(teacher(5L), 7L,
                new CreateInviteRequest(InviteType.STUDENT, null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("OWNER/MAINTAINER");
    }

    @Test
    void studentAcceptCreatesAccountAndReturnsGeneratedUsername() {
        Invite invite = usableInvite(InviteType.STUDENT);
        User student = mock(User.class);
        when(student.getUsername()).thenReturn("dodam01");
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));
        when(studentAccountIssuer.enroll(any(Classroom.class), anyString(), anyString(),
                anyShort(), anyString())).thenReturn(student);

        AcceptInviteResponse response = service.accept("AB3D9F",
                new AcceptInviteRequest("김민수", (short) 3, "싸피초", "pw1234"), null);

        assertThat(response.username()).isEqualTo("dodam01");
        assertThat(response.role()).isEqualTo("STUDENT");
        assertThat(response.classroomId()).isEqualTo(7L);
        assertThat(invite.getUsedCount()).isEqualTo(1);
    }

    @Test
    void studentAcceptRequiresAccountInfo() {
        Invite invite = usableInvite(InviteType.STUDENT);
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));

        assertThatThrownBy(() -> service.accept("AB3D9F",
                new AcceptInviteRequest("김민수", null, "싸피초", "pw1234"), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이름·학교·학년·비밀번호");
        assertThat(invite.getUsedCount()).isZero();
    }

    @Test
    void teacherAcceptJoinsAsMaintainer() {
        Invite invite = usableInvite(InviteType.TEACHER);
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));
        // 삭제된 행까지 보고 판단한다 — @SQLRestriction 걸린 조회로는 강퇴된 선생님을 못 본다
        when(memberRepository.findIncludingDeleted(7L, 2L)).thenReturn(Optional.empty());
        when(userRepository.getReferenceById(2L)).thenReturn(mock(User.class));

        AcceptInviteResponse response = service.accept("AB3D9F", null, teacher(2L));

        assertThat(response.role()).isEqualTo("MAINTAINER");
        assertThat(response.username()).isNull();
        ArgumentCaptor<ClassroomMember> captor = ArgumentCaptor.forClass(ClassroomMember.class);
        verify(memberRepository).save(captor.capture());
        assertThat(captor.getValue().getRole()).isEqualTo(ClassroomRole.MAINTAINER);
    }

    @Test
    void teacherInviteRejectsAnonymousAccept() {
        Invite invite = usableInvite(InviteType.TEACHER);
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));

        assertThatThrownBy(() -> service.accept("AB3D9F", null, null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("로그인한 선생님");
    }

    @Test
    void exhaustedInviteIsGone() {
        Invite invite = Invite.issue(classroom, mock(User.class), InviteType.STUDENT,
                "AB3D9F", LocalDateTime.now().plusHours(1), 1);
        invite.use(); // 1회짜리를 다 씀
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));

        assertThatThrownBy(() -> service.accept("AB3D9F",
                new AcceptInviteRequest("김민수", (short) 3, "싸피초", "pw1234"), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("사용할 수 없는 초대");
        verify(studentAccountIssuer, never()).enroll(any(), any(), any(), anyShort(), any());
    }

    @Test
    void revokedInviteIsGone() {
        Invite invite = usableInvite(InviteType.STUDENT);
        invite.revoke();
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));

        assertThatThrownBy(() -> service.accept("AB3D9F",
                new AcceptInviteRequest("김민수", (short) 3, "싸피초", "pw1234"), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("사용할 수 없는 초대");
    }

    @Test
    void expiredInviteIsGone() {
        Invite invite = Invite.issue(classroom, mock(User.class), InviteType.STUDENT,
                "AB3D9F", LocalDateTime.now().minusMinutes(1), 30);
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));

        assertThatThrownBy(() -> service.accept("AB3D9F",
                new AcceptInviteRequest("김민수", (short) 3, "싸피초", "pw1234"), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("사용할 수 없는 초대");
    }

    @Test
    void alreadyMemberTeacherIsConflict() {
        Invite invite = usableInvite(InviteType.TEACHER);
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));
        ClassroomMember active = mock(ClassroomMember.class);
        when(active.isDeleted()).thenReturn(false);
        when(memberRepository.findIncludingDeleted(7L, 2L)).thenReturn(Optional.of(active));

        assertThatThrownBy(() -> service.accept("AB3D9F", null, teacher(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이미 이 학급의 구성원");
    }

    /**
     * 제외했던 선생님을 다시 초대하는 경우. 예전에는 여기서 새 행을 넣어
     * {@code uq_classroom_member} 위반 500 이 났다 — 유니크 제약이 삭제된 행까지 덮기 때문이다.
     */
    @Test
    void removedTeacherRejoinsByRevivingTheOldRow() {
        Invite invite = usableInvite(InviteType.TEACHER);
        ClassroomMember removed = mock(ClassroomMember.class);
        when(removed.isDeleted()).thenReturn(true);
        when(inviteRepository.findByCodeForUpdate("AB3D9F")).thenReturn(Optional.of(invite));
        when(memberRepository.findIncludingDeleted(7L, 2L)).thenReturn(Optional.of(removed));

        AcceptInviteResponse response = service.accept("AB3D9F", null, teacher(2L));

        assertThat(response.role()).isEqualTo("MAINTAINER");
        verify(removed).restore(ClassroomRole.MAINTAINER);
        // 새 행을 만들지 않는다 — 만들면 운영 DB 에서 유니크 위반이다
        verify(userRepository, never()).getReferenceById(2L);
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private Invite usableInvite(InviteType type) {
        return Invite.issue(classroom, mock(User.class), type, "AB3D9F",
                LocalDateTime.now().plusHours(48), type.defaultMaxUses());
    }

    private void managerIs(Long userId, ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        lenient().when(memberRepository.findByClassroomIdAndUserId(7L, userId))
                .thenReturn(Optional.of(member));
        lenient().when(userRepository.getReferenceById(userId)).thenReturn(mock(User.class));
    }
}
