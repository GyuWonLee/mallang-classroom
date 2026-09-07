package com.mallang.auth.controller;

import com.mallang.auth.dto.AuthDtos.ChangePasswordRequest;
import com.mallang.auth.dto.AuthDtos.LoginRequest;
import com.mallang.auth.dto.AuthDtos.PasswordResetConfirmRequest;
import com.mallang.auth.dto.AuthDtos.PasswordResetRequest;
import com.mallang.auth.dto.AuthDtos.RefreshRequest;
import com.mallang.auth.dto.AuthDtos.TeacherSignupRequest;
import com.mallang.auth.dto.AuthDtos.TokenResponse;
import com.mallang.auth.dto.AuthDtos.UserSummary;
import com.mallang.auth.service.AuthService;
import com.mallang.auth.service.PasswordResetService;
import com.mallang.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;

@Tag(name = "Auth", description = "인증 — 회원가입/로그인/토큰 재발급")
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final PasswordResetService passwordResetService;

    @Operation(summary = "선생님 회원가입")
    @PostMapping("/teachers/signup")
    public ResponseEntity<UserSummary> signupTeacher(@Valid @RequestBody TeacherSignupRequest request) {
        UserSummary user = authService.signupTeacher(request);
        return ResponseEntity.created(URI.create("/api/users/" + user.id())).body(user);
    }

    @Operation(summary = "로그인 (선생님: 이메일 / 학생: 발급 아이디)")
    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @Operation(summary = "accessToken 재발급 (refresh 회전)")
    @PostMapping("/refresh")
    public TokenResponse refresh(@Valid @RequestBody RefreshRequest request) {
        return authService.refresh(request.refreshToken());
    }

    @Operation(summary = "로그아웃 (refresh 무효화)")
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal AuthUser authUser) {
        authService.logout(authUser.id());
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    @Operation(summary = "비밀번호 변경 (학생·선생님 공용) — 변경 후 모든 기기에서 재로그인 필요")
    @PostMapping("/password")
    public ResponseEntity<Void> changePassword(
            @AuthenticationPrincipal AuthUser authUser,
            @Valid @RequestBody ChangePasswordRequest request) {
        authService.changePassword(authUser.id(), request);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    @Operation(summary = "비밀번호 재설정 메일 요청 (선생님 전용) — 가입 여부와 무관하게 항상 204")
    @PostMapping("/password-reset/request")
    public ResponseEntity<Void> requestPasswordReset(
            @Valid @RequestBody PasswordResetRequest request,
            HttpServletRequest servletRequest) {
        passwordResetService.request(request, servletRequest.getRemoteAddr());
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    @Operation(summary = "비밀번호 재설정 완료 (메일 링크의 토큰 사용) — 이후 모든 기기에서 재로그인 필요")
    @PostMapping("/password-reset/confirm")
    public ResponseEntity<Void> confirmPasswordReset(
            @Valid @RequestBody PasswordResetConfirmRequest request) {
        passwordResetService.confirm(request);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    @Operation(summary = "내 정보")
    @GetMapping("/me")
    public UserSummary me(@AuthenticationPrincipal AuthUser authUser) {
        return authService.me(authUser.id());
    }
}
