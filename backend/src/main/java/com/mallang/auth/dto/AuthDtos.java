package com.mallang.auth.dto;

import com.mallang.user.entity.User;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 인증 도메인 요청/응답 DTO 모음.
 * record = 불변 데이터 그릇, 검증은 Bean Validation(@NotBlank 등) + 컨트롤러의 @Valid가 담당.
 */
public class AuthDtos {

    public record TeacherSignupRequest(
            @NotBlank @Email String email,
            @NotBlank @Size(min = 8, max = 64) String password,
            @NotBlank String name,
            @NotBlank String school
    ) {}

    public record LoginRequest(
            @NotBlank String username,
            @NotBlank String password
    ) {}

    public record RefreshRequest(
            @NotBlank String refreshToken
    ) {}

    /**
     * 비밀번호 변경 — 학생·선생님 공용. 학생 계정은 선생님이 발급한 임시 비밀번호로 시작하므로
     * 본인이 바꿀 수단이 반드시 있어야 한다.
     * 새 비밀번호 규칙은 선생님 회원가입과 동일하게 맞춘다(같은 로그인 창을 쓰는데 규칙이 다르면 혼란).
     */
    public record ChangePasswordRequest(
            @NotBlank String currentPassword,
            @NotBlank @Size(min = 8, max = 64) String newPassword
    ) {}

    /**
     * 재설정 메일 요청 — 선생님 전용이라 이메일로 받는다.
     * 학생은 이메일이 없어 이 길을 쓸 수 없다(선생님이 학생 관리에서 초기화해 준다).
     */
    public record PasswordResetRequest(
            @NotBlank @Email String email
    ) {}

    /** 메일 링크로 들어와 새 비밀번호를 정한다. 규칙은 회원가입·비밀번호 변경과 같게 맞춘다. */
    public record PasswordResetConfirmRequest(
            @NotBlank String token,
            @NotBlank @Size(min = 8, max = 64) String newPassword
    ) {}

    public record TokenResponse(
            String accessToken,
            String refreshToken,
            UserSummary user
    ) {}

    public record UserSummary(
            Long id,
            String name,
            String role,
            String school,
            Short grade
    ) {
        public static UserSummary from(User user) {
            return new UserSummary(user.getId(), user.getName(), user.getRole().name(),
                    user.getSchool(), user.getGrade());
        }
    }
}
