package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.PasswordResetResponse;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 학급 경로 없이 학생 개인을 다루는 API (명세 §3).
 * 권한은 "요청자가 관리하는 학급 중에 이 학생이 있는가"로 판단한다 —
 * URL 에 classroomId 가 없으므로 멤버십을 역으로 조회해야 한다.
 */
@Service
@RequiredArgsConstructor
public class StudentService {

    private static final List<ClassroomRole> MANAGE_ROLES =
            List.of(ClassroomRole.OWNER, ClassroomRole.MAINTAINER);

    private final UserRepository userRepository;
    private final ClassroomMemberRepository memberRepository;
    private final StudentAccountIssuer studentAccountIssuer;

    /** 학생 비밀번호 초기화 — 저학년 분실 대응. 평문은 응답에서 1회만 노출된다 */
    @Transactional
    public PasswordResetResponse resetPassword(AuthUser authUser, Long studentId) {
        User student = userRepository.findById(studentId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "student-not-found",
                        "학생을 찾을 수 없습니다."));
        if (student.isTeacher()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "not-a-student",
                    "학생 계정만 초기화할 수 있습니다.");
        }
        if (!memberRepository.managesMember(authUser.id(), studentId, MANAGE_ROLES)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-a-manager",
                    "이 학생이 속한 학급의 관리자만 초기화할 수 있습니다.");
        }
        String temporaryPassword = studentAccountIssuer.resetPassword(student);
        return new PasswordResetResponse(student.getUsername(), temporaryPassword);
    }
}
