package com.mallang.auth.service;

import com.mallang.auth.dto.AuthDtos.ChangePasswordRequest;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.JwtTokenProvider;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 비밀번호 변경 — S15P11A407-131
 *
 * 학생 계정은 선생님이 발급한 임시 비밀번호로 시작한다. 그 비밀번호가 적힌 안내장이
 * 돌아다니는 상황을 가정하므로, 바꾼 뒤 기존 세션이 살아 있으면 안 된다.
 * 인코더는 목이 아니라 실제 BCrypt 를 쓴다 — 해시 검증이 이 기능의 핵심이라 목으로 덮으면
 * 검증한 게 없어진다.
 */
@ExtendWith(MockitoExtension.class)
class ChangePasswordTest {

    private static final String CURRENT = "dodam-temp-1234";

    @Mock UserRepository userRepository;
    @Mock JwtTokenProvider jwtTokenProvider;
    @Mock RefreshTokenService refreshTokenService;

    private final PasswordEncoder encoder = new BCryptPasswordEncoder();
    private AuthService service;
    private User student;

    @BeforeEach
    void setUp() {
        service = new AuthService(userRepository, encoder, jwtTokenProvider, refreshTokenService);
        student = User.createStudent("dodam01", encoder.encode(CURRENT), "김민수", "싸피초", (short) 3);
    }

    @Test
    void replacesPasswordWithHashAndKillsExistingSessions() {
        when(userRepository.findById(11L)).thenReturn(Optional.of(student));

        service.changePassword(11L, new ChangePasswordRequest(CURRENT, "my-own-password"));

        assertThat(encoder.matches("my-own-password", student.getPassword())).isTrue();
        // 평문이 그대로 저장되면 안 된다
        assertThat(student.getPassword()).isNotEqualTo("my-own-password");
        // 안내장에 적힌 옛 비밀번호로는 더 이상 안 된다
        assertThat(encoder.matches(CURRENT, student.getPassword())).isFalse();
        // 다른 기기에 남은 세션 무효화 — 안 하면 비밀번호를 바꾼 의미가 없다
        verify(refreshTokenService).delete(11L);
    }

    @Test
    void wrongCurrentPasswordLeavesPasswordUntouched() {
        when(userRepository.findById(11L)).thenReturn(Optional.of(student));
        String before = student.getPassword();

        assertThatThrownBy(() -> service.changePassword(11L,
                new ChangePasswordRequest("모르는-비밀번호", "my-own-password")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("현재 비밀번호");

        assertThat(student.getPassword()).isEqualTo(before);
        verify(refreshTokenService, never()).delete(11L);
    }

    @Test
    void rejectsReusingTheSamePassword() {
        when(userRepository.findById(11L)).thenReturn(Optional.of(student));

        // 임시 비밀번호를 그대로 다시 넣는 실수 — 바꾼 척만 되는 상황을 막는다
        assertThatThrownBy(() -> service.changePassword(11L,
                new ChangePasswordRequest(CURRENT, CURRENT)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("다른 것으로");

        verify(refreshTokenService, never()).delete(11L);
    }

    @Test
    void unknownUserIsUnauthorized() {
        when(userRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.changePassword(99L,
                new ChangePasswordRequest(CURRENT, "my-own-password")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("사용자를 찾을 수 없습니다");
    }
}
