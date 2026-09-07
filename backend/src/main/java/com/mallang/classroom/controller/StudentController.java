package com.mallang.classroom.controller;

import com.mallang.classroom.dto.ClassroomDtos.PasswordResetResponse;
import com.mallang.classroom.service.StudentService;
import com.mallang.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Student", description = "학생 계정 — 비밀번호 초기화")
@RestController
@RequestMapping("/api/students")
@RequiredArgsConstructor
public class StudentController {

    private final StudentService studentService;

    @Operation(summary = "학생 비밀번호 초기화 (학급 관리자 — 새 임시 비밀번호 1회 반환)")
    @PostMapping("/{studentId}/password-reset")
    public PasswordResetResponse resetPassword(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long studentId) {
        return studentService.resetPassword(authUser, studentId);
    }
}
