package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.CreateStudentRequest;
import com.mallang.classroom.dto.ClassroomDtos.StudentAccountResponse;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.team.service.TeamAssignmentService;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.stream.Collectors;

/**
 * 학생 계정 발급 + 학급/팀 편입 공통 로직.
 * 두 경로가 이걸 공유한다 — 선생님이 직접 만드는 경로(ClassroomService)와
 * 학생이 초대 코드로 가입하는 경로(InviteService). 아이디 규칙·팀 편입이 어긋나지 않게 한 곳에 둔다.
 */
@Component
@RequiredArgsConstructor
public class StudentAccountIssuer {

    // 저학년이 옮겨 적기 쉽도록 혼동 문자(l/1, 0/o) 제외
    private static final String PASSWORD_CHARSET = "abcdefghjkmnpqrstuvwxyz23456789";
    private static final int PASSWORD_LENGTH = 8;

    private final UserRepository userRepository;
    private final ClassroomMemberRepository memberRepository;
    private final TeamAssignmentService teamAssignmentService;
    private final PasswordEncoder passwordEncoder;
    private final SecureRandom random = new SecureRandom();

    /** 선생님이 발급 — 임시 비밀번호를 만들어 평문으로 1회 돌려준다 */
    public StudentAccountResponse issue(Classroom classroom, CreateStudentRequest request) {
        String temporaryPassword = generateTemporaryPassword();
        User student = enroll(classroom, request.name(), request.school(), request.grade(),
                temporaryPassword, request.parentEmail());
        return StudentAccountResponse.of(student, temporaryPassword);
    }

    /** 초대 코드로 학생이 직접 가입하는 경로 — 학부모 이메일을 받지 않는다 */
    public User enroll(Classroom classroom, String name, String school, short grade,
                       String rawPassword) {
        return enroll(classroom, name, school, grade, rawPassword, null);
    }

    /** 학생 계정 생성 + 학급 등록 + 학년 팀 편입 (비밀번호는 호출자가 정한다) */
    public User enroll(Classroom classroom, String name, String school, short grade,
                       String rawPassword, String parentEmail) {
        requireAcceptedGrade(classroom, grade);
        String username = nextStudentUsername(classroom.getAlias());
        User student = userRepository.save(User.createStudent(
                username, passwordEncoder.encode(rawPassword), name, school, grade, parentEmail));
        memberRepository.save(ClassroomMember.join(classroom, student, ClassroomRole.STUDENT));
        // 팀 = 학급 내 같은 학년 자동 그룹 — 등록과 동시에 편입 (LiveKit 팀룸의 전제)
        teamAssignmentService.assignToGradeTeam(classroom, student);
        return student;
    }

    /**
     * 학급이 담당하지 않는 학년의 학생은 받지 않는다 (팀 = 학년이라 학급 밖 학년이 섞이면
     * 담당하지 않는 팀이 생긴다). 단건·CSV·초대 가입이 모두 이 메서드를 지나므로 여기서 한 번만 막는다.
     */
    private void requireAcceptedGrade(Classroom classroom, short grade) {
        if (!classroom.accepts(grade)) {
            String allowed = classroom.getGrades().stream()
                    .map(String::valueOf)
                    .collect(Collectors.joining("·"));
            throw new ApiException(HttpStatus.BAD_REQUEST, "grade-not-in-classroom",
                    "이 학급은 %s학년만 받습니다. (요청 학년: %d)".formatted(allowed, grade));
        }
    }

    // {alias}{2자리 번호} — dodam01, dodam02, ... (동시 생성 충돌은 username UNIQUE가 최종 방어)
    // 삭제된 계정 포함 카운트 사용: 탈퇴 학생 번호를 재사용하면 DB UNIQUE와 충돌하기 때문
    private String nextStudentUsername(String alias) {
        long next = userRepository.countByUsernamePrefixIncludingDeleted(alias) + 1;
        String candidate;
        do {
            candidate = String.format("%s%02d", alias, next++);
        } while (userRepository.existsByUsernameIncludingDeleted(candidate));
        return candidate;
    }

    /**
     * 비밀번호 초기화 — 새 임시 비밀번호를 평문으로 돌려준다 (분실 대응).
     * 문자셋 규칙은 최초 발급과 동일해야 한다: 저학년이 옮겨 적는 건 똑같기 때문.
     */
    public String resetPassword(User student) {
        String temporaryPassword = generateTemporaryPassword();
        student.changePassword(passwordEncoder.encode(temporaryPassword));
        return temporaryPassword;
    }

    private String generateTemporaryPassword() {
        StringBuilder sb = new StringBuilder(PASSWORD_LENGTH);
        for (int i = 0; i < PASSWORD_LENGTH; i++) {
            sb.append(PASSWORD_CHARSET.charAt(random.nextInt(PASSWORD_CHARSET.length())));
        }
        return sb.toString();
    }
}
