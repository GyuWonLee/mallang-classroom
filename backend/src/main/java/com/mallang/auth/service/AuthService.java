package com.mallang.auth.service;

import com.mallang.auth.dto.AuthDtos.ChangePasswordRequest;
import com.mallang.auth.dto.AuthDtos.LoginRequest;
import com.mallang.auth.dto.AuthDtos.TeacherSignupRequest;
import com.mallang.auth.dto.AuthDtos.TokenResponse;
import com.mallang.auth.dto.AuthDtos.UserSummary;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.JwtTokenProvider;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final RefreshTokenService refreshTokenService;

    @Transactional
    public UserSummary signupTeacher(TeacherSignupRequest request) {
        // 삭제된 계정까지 봐야 한다 — users_username_key 는 soft delete 된 행도 덮으므로,
        // @SQLRestriction 이 걸린 조회로 검사하면 탈퇴한 이메일에 대해 409 대신 500 이 난다
        if (userRepository.existsByUsernameIncludingDeleted(request.email())) {
            throw new ApiException(HttpStatus.CONFLICT, "duplicate-username",
                    "이미 사용 중인 이메일입니다.");
        }
        User teacher = User.createTeacher(
                request.email(),
                passwordEncoder.encode(request.password()),
                request.name(),
                request.school());
        return UserSummary.from(userRepository.save(teacher));
    }

    public TokenResponse login(LoginRequest request) {
        User user = userRepository.findByUsername(request.username())
                .filter(u -> passwordEncoder.matches(request.password(), u.getPassword()))
                // 아이디 없음/비밀번호 불일치를 구분하지 않음 — 계정 존재 여부 노출 방지
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "invalid-credentials",
                        "아이디 또는 비밀번호가 올바르지 않습니다."));
        return issueTokens(user);
    }

    public TokenResponse refresh(String refreshToken) {
        Claims claims = parseRefreshToken(refreshToken);
        Long userId = Long.valueOf(claims.getSubject());

        // Redis에 저장된 최신 refresh와 일치해야 함 — 회전(rotation)으로 옛 토큰 재사용 차단
        if (!refreshTokenService.matches(userId, refreshToken)) {
            refreshTokenService.delete(userId); // 재사용 감지 → 세션 무효화 (탈취 의심)
            throw new ApiException(HttpStatus.UNAUTHORIZED, "invalid-refresh-token",
                    "다시 로그인해 주세요.");
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "invalid-refresh-token",
                        "다시 로그인해 주세요."));
        return issueTokens(user);
    }

    public void logout(Long userId) {
        refreshTokenService.delete(userId);
    }

    /**
     * 비밀번호 변경 — 현재 비밀번호를 확인한 뒤 교체한다.
     *
     * 바꾼 뒤 refresh 토큰을 지운다. 남의 기기에 남은 세션이 계속 살아 있으면
     * 비밀번호를 바꾼 의미가 없다(임시 비밀번호가 적힌 안내장이 돌아다니는 상황을 가정).
     * 그래서 변경 후에는 모든 기기에서 다시 로그인해야 한다.
     */
    @Transactional
    public void changePassword(Long userId, ChangePasswordRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized",
                        "사용자를 찾을 수 없습니다."));

        if (!passwordEncoder.matches(request.currentPassword(), user.getPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-current-password",
                    "현재 비밀번호가 올바르지 않습니다.");
        }
        if (passwordEncoder.matches(request.newPassword(), user.getPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "same-password",
                    "지금 쓰는 비밀번호와 다른 것으로 정해 주세요.");
        }

        user.changePassword(passwordEncoder.encode(request.newPassword()));
        refreshTokenService.delete(userId);
    }

    public UserSummary me(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized",
                        "사용자를 찾을 수 없습니다."));
        return UserSummary.from(user);
    }

    private TokenResponse issueTokens(User user) {
        String accessToken = jwtTokenProvider.createAccessToken(
                user.getId(), user.getRole(), user.getName());
        String refreshToken = jwtTokenProvider.createRefreshToken(user.getId(), user.getRole());
        refreshTokenService.save(user.getId(), refreshToken); // 회전: 항상 최신 것만 유효
        return new TokenResponse(accessToken, refreshToken, UserSummary.from(user));
    }

    private Claims parseRefreshToken(String refreshToken) {
        try {
            Claims claims = jwtTokenProvider.parse(refreshToken);
            if (!JwtTokenProvider.TYPE_REFRESH.equals(
                    claims.get(JwtTokenProvider.CLAIM_TYPE, String.class))) {
                throw new JwtException("not a refresh token");
            }
            return claims;
        } catch (JwtException | IllegalArgumentException e) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "invalid-refresh-token",
                    "다시 로그인해 주세요.");
        }
    }
}
