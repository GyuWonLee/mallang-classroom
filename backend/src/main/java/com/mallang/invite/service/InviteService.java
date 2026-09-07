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
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.List;

import java.util.Optional;

/**
 * 학급 초대 (명세 §3). 학급 입장은 초대 기반만 허용 — 공개 탐색 경로가 없다.
 * 유효 조건: revoked_at IS NULL AND expires_at > now AND used_count < max_uses.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class InviteService {

    // 혼동 문자(0/O, 1/I/L) 제외 — 저학년이 칠판에서 옮겨 적는 경로라 오독이 곧 실패다
    private static final String CODE_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 6;
    private static final int DEFAULT_EXPIRES_IN_HOURS = 48;

    private final InviteRepository inviteRepository;
    private final ClassroomRepository classroomRepository;
    private final ClassroomMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final StudentAccountIssuer studentAccountIssuer;
    private final SecureRandom random = new SecureRandom();

    @Transactional
    public InviteResponse create(AuthUser authUser, Long classroomId, CreateInviteRequest request) {
        Classroom classroom = classroomRepository.findById(classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "classroom-not-found",
                        "학급을 찾을 수 없습니다."));
        requireManager(classroomId, authUser.id());

        int maxUses = request.maxUses() != null
                ? request.maxUses() : request.type().defaultMaxUses();
        int hours = request.expiresInHours() != null
                ? request.expiresInHours() : DEFAULT_EXPIRES_IN_HOURS;
        Invite invite = inviteRepository.save(Invite.issue(
                classroom, userRepository.getReferenceById(authUser.id()), request.type(),
                generateCode(), LocalDateTime.now().plusHours(hours), maxUses));
        return InviteResponse.from(invite);
    }

    /** 유효한 초대만 (만료·회수·소진 제외) */
    public List<InviteResponse> list(AuthUser authUser, Long classroomId) {
        requireManager(classroomId, authUser.id());
        return inviteRepository.findUsableByClassroomId(classroomId, LocalDateTime.now()).stream()
                .map(InviteResponse::from)
                .toList();
    }

    /** 즉시 회수 — 코드가 유출됐을 때의 대응 수단 */
    @Transactional
    public void revoke(AuthUser authUser, Long inviteId) {
        Invite invite = inviteRepository.findById(inviteId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "invite-not-found",
                        "초대를 찾을 수 없습니다."));
        requireManager(invite.getClassroom().getId(), authUser.id());
        invite.revoke();
    }

    /**
     * 초대 수락. TEACHER 는 로그인한 선생님을 MAINTAINER 로 등록하고,
     * STUDENT 는 계정을 만들며 학급·학년 팀까지 편입한다.
     * 조회에 비관적 락을 걸어 동시 수락에서도 maxUses 를 넘지 않게 한다.
     */
    @Transactional
    public AcceptInviteResponse accept(String code, AcceptInviteRequest request, AuthUser authUser) {
        Invite invite = inviteRepository.findByCodeForUpdate(code)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "invite-not-found",
                        "초대 코드를 찾을 수 없습니다."));
        if (!invite.isUsable(LocalDateTime.now())) {
            throw new ApiException(HttpStatus.GONE, "invite-expired",
                    "만료되었거나 사용할 수 없는 초대입니다.");
        }
        Classroom classroom = invite.getClassroom();
        AcceptInviteResponse response = invite.getType() == InviteType.TEACHER
                ? acceptAsTeacher(classroom, authUser)
                : acceptAsStudent(classroom, request);
        invite.use();
        return response;
    }

    private AcceptInviteResponse acceptAsTeacher(Classroom classroom, AuthUser authUser) {
        if (authUser == null || !authUser.isTeacher()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "teacher-login-required",
                    "선생님 초대는 로그인한 선생님만 수락할 수 있습니다.");
        }
        /*
          삭제된 행까지 보고 판단한다.

          엔티티에 @SQLRestriction 이 걸려 있어 일반 조회는 강퇴된 구성원을 못 본다. 그런데
          uq_classroom_member(classroom_id, user_id) 는 삭제된 행까지 덮으므로, 예전에는
          "없다"고 보고 새로 save 해서 **제외했던 선생님을 다시 초대하면 수락 순간 500** 이 났다.
          ClassroomMember 주석과 V2__classroom.sql:19 가 "재가입 = 기존 행 재활성화"라고
          두 번 적어 둔 그 동작을 이제 실제로 한다.
        */
        Optional<ClassroomMember> existing =
                memberRepository.findIncludingDeleted(classroom.getId(), authUser.id());
        if (existing.isPresent()) {
            ClassroomMember member = existing.get();
            if (!member.isDeleted()) {
                throw new ApiException(HttpStatus.CONFLICT, "already-a-member",
                        "이미 이 학급의 구성원입니다.");
            }
            member.restore(ClassroomRole.MAINTAINER);
            memberRepository.save(member);
        } else {
            User teacher = userRepository.getReferenceById(authUser.id());
            memberRepository.save(ClassroomMember.join(classroom, teacher, ClassroomRole.MAINTAINER));
        }
        return new AcceptInviteResponse(classroom.getId(), classroom.getName(),
                ClassroomRole.MAINTAINER.name(), null);
    }

    private AcceptInviteResponse acceptAsStudent(Classroom classroom, AcceptInviteRequest request) {
        if (request == null || isBlank(request.name()) || isBlank(request.school())
                || request.grade() == null || isBlank(request.password())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "student-info-required",
                    "학생 가입에는 이름·학교·학년·비밀번호가 필요합니다.");
        }
        User student = studentAccountIssuer.enroll(classroom, request.name(), request.school(),
                request.grade(), request.password());
        return new AcceptInviteResponse(classroom.getId(), classroom.getName(),
                ClassroomRole.STUDENT.name(), student.getUsername());
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String generateCode() {
        for (int attempt = 0; attempt < 10; attempt++) {
            StringBuilder sb = new StringBuilder(CODE_LENGTH);
            for (int i = 0; i < CODE_LENGTH; i++) {
                sb.append(CODE_CHARSET.charAt(random.nextInt(CODE_CHARSET.length())));
            }
            String code = sb.toString();
            if (!inviteRepository.existsByCode(code)) {
                return code;
            }
        }
        throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "code-generation-failed",
                "초대 코드를 생성하지 못했습니다. 다시 시도해주세요.");
    }

    private void requireManager(Long classroomId, Long userId) {
        ClassroomRole role = memberRepository.findByClassroomIdAndUserId(classroomId, userId)
                .map(ClassroomMember::getRole)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "manager-only",
                    "초대 관리는 OWNER/MAINTAINER만 가능합니다.");
        }
    }
}
