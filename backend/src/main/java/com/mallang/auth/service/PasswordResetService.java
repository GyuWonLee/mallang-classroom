package com.mallang.auth.service;

import com.mallang.auth.dto.AuthDtos.PasswordResetConfirmRequest;
import com.mallang.auth.dto.AuthDtos.PasswordResetRequest;
import com.mallang.global.error.ApiException;
import com.mallang.global.support.FixedWindowRateLimiter;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.Locale;

/**
 * 선생님 비밀번호 재설정 (메일 링크 방식).
 *
 * <p><b>선생님 전용이다.</b> 학생 계정에는 이메일이 없고(아이디가 {@code dodam01} 처럼
 * 발급된 값이다) 보낼 곳이 없다. 학생이 비밀번호를 잊으면 선생님이 학생 관리에서
 * 초기화해 준다 — 같은 교실에 있으니 그쪽이 더 빠르고, 대면 확인이라 더 안전하다.</p>
 *
 * <p>선생님에게는 그렇게 해 줄 사람이 없다는 것이 이 기능이 필요한 이유다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PasswordResetService {

    /** 한 사람이 연달아 누르는 것까지 막을 필요는 없지만, 메일 폭탄은 막아야 한다 */
    private static final int MAX_PER_EMAIL = 3;
    private static final Duration EMAIL_WINDOW = Duration.ofHours(1);
    /** 계정을 바꿔가며 훑는 시도를 막는다 */
    private static final int MAX_PER_IP = 10;
    private static final Duration IP_WINDOW = Duration.ofMinutes(10);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final PasswordResetTokenService tokenService;
    private final PasswordResetMailSender mailSender;
    private final RefreshTokenService refreshTokenService;
    private final FixedWindowRateLimiter rateLimiter;

    /**
     * 재설정 메일 요청.
     *
     * <p>가입된 메일이든 아니든 <b>응답이 똑같다.</b> 다르게 주면 이 화면이 "가입 여부
     * 조회기" 가 된다 — 로그인이 아이디 없음과 비밀번호 불일치를 구분하지 않는 것과 같은
     * 이유다.</p>
     */
    @Transactional(readOnly = true)
    public void request(PasswordResetRequest request, String clientIp) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        rateLimiter.check("pwreset-ip", clientIp, MAX_PER_IP, IP_WINDOW);
        rateLimiter.check("pwreset-email", email, MAX_PER_EMAIL, EMAIL_WINDOW);

        userRepository.findByUsername(email)
                // 학생 계정은 아이디가 이메일이 아니라 애초에 걸리지 않지만, 역할로 한 번 더 못 박는다
                .filter(user -> user.getRole() == Role.TEACHER)
                .ifPresentOrElse(
                        user -> mailSender.send(
                                user, tokenService.issue(user.getId()), tokenService.getTokenValidity()),
                        () -> log.info("가입되지 않은 주소로 비밀번호 재설정 요청이 들어왔습니다."));
    }

    /**
     * 링크를 타고 들어와 새 비밀번호를 정한다.
     *
     * <p>바꾼 뒤 refresh 토큰을 지운다. 계정을 잃어버렸다고 판단해 재설정하는 흐름인데
     * 남의 기기에 남은 세션이 그대로 살아 있으면 되찾는 의미가 없다.</p>
     */
    @Transactional
    public void confirm(PasswordResetConfirmRequest request) {
        Long userId = tokenService.consume(request.token());
        if (userId == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-reset-token",
                    "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.");
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "invalid-reset-token",
                        "링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요."));

        user.changePassword(passwordEncoder.encode(request.newPassword()));
        refreshTokenService.delete(userId);
        log.info("비밀번호 재설정 완료. userId={}", userId);
    }
}
