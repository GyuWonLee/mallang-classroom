package com.mallang.auth.service;

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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 인증 — 가입·로그인·토큰 회전.
 *
 * <p>여기서 지키는 것 두 가지: 계정 존재 여부를 응답으로 흘리지 않는 것,
 * 그리고 refresh 토큰을 한 번만 쓰게 하는 것(재사용이 감지되면 세션을 통째로 버린다).</p>
 */
@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock UserRepository userRepository;
    @Mock PasswordEncoder passwordEncoder;
    @Mock JwtTokenProvider jwtTokenProvider;
    @Mock RefreshTokenService refreshTokenService;
    @InjectMocks AuthService service;

    @Test
    void signsUpATeacher() {
        when(userRepository.existsByUsernameIncludingDeleted("teacher@mallang.app")).thenReturn(false);
        when(passwordEncoder.encode("pw12345678")).thenReturn("encoded");
        when(userRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        UserSummary summary = service.signupTeacher(new TeacherSignupRequest(
                "teacher@mallang.app", "pw12345678", "김선생", "말랑초등학교"));

        assertThat(summary.name()).isEqualTo("김선생");
        // 비밀번호는 절대 평문으로 저장하지 않는다
        verify(passwordEncoder).encode("pw12345678");
    }

    @Test
    void duplicateEmailIsRejected() {
        when(userRepository.existsByUsernameIncludingDeleted("teacher@mallang.app")).thenReturn(true);

        assertThatThrownBy(() -> service.signupTeacher(new TeacherSignupRequest(
                "teacher@mallang.app", "pw12345678", "김선생", "말랑초등학교")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이미 사용 중인");

        verify(userRepository, never()).save(any());
    }

    @Test
    void loginIssuesBothTokensAndStoresTheRefresh() {
        Optional<User> found = Optional.of(teacher());
        when(userRepository.findByUsername("teacher@mallang.app")).thenReturn(found);
        when(passwordEncoder.matches("pw", "encoded")).thenReturn(true);
        when(jwtTokenProvider.createAccessToken(1L, Role.TEACHER, "김선생")).thenReturn("access");
        when(jwtTokenProvider.createRefreshToken(1L, Role.TEACHER)).thenReturn("refresh");

        TokenResponse tokens = service.login(new LoginRequest("teacher@mallang.app", "pw"));

        assertThat(tokens.accessToken()).isEqualTo("access");
        assertThat(tokens.refreshToken()).isEqualTo("refresh");
        // 회전 — 최신 refresh 만 유효해야 하므로 발급할 때마다 저장한다
        verify(refreshTokenService).save(1L, "refresh");
    }

    @Test
    void wrongPasswordAndUnknownUserGiveTheSameAnswer() {
        when(userRepository.findByUsername("nobody")).thenReturn(Optional.empty());

        // 메시지가 갈리면 계정이 있는지 없는지를 밖에서 알아낼 수 있다
        assertThatThrownBy(() -> service.login(new LoginRequest("nobody", "pw")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("아이디 또는 비밀번호가 올바르지 않습니다");

        Optional<User> found = Optional.of(teacher());
        when(userRepository.findByUsername("teacher@mallang.app")).thenReturn(found);
        when(passwordEncoder.matches("wrong", "encoded")).thenReturn(false);

        assertThatThrownBy(() -> service.login(new LoginRequest("teacher@mallang.app", "wrong")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("아이디 또는 비밀번호가 올바르지 않습니다");
    }

    @Test
    void refreshRotatesTheToken() {
        User user = teacher();
        Claims claims = refreshClaims("1");   // when(...) 밖에서 만든다 (중첩 스텁 방지)
        when(jwtTokenProvider.parse("refresh")).thenReturn(claims);
        when(refreshTokenService.matches(1L, "refresh")).thenReturn(true);
        Optional<User> found = Optional.of(user);
        when(userRepository.findById(1L)).thenReturn(found);
        when(jwtTokenProvider.createAccessToken(1L, Role.TEACHER, "김선생")).thenReturn("access2");
        when(jwtTokenProvider.createRefreshToken(1L, Role.TEACHER)).thenReturn("refresh2");

        TokenResponse tokens = service.refresh("refresh");

        assertThat(tokens.refreshToken()).isEqualTo("refresh2");
        verify(refreshTokenService).save(1L, "refresh2");
    }

    @Test
    void reusingAnOldRefreshTokenKillsTheWholeSession() {
        Claims claims = refreshClaims("1");
        when(jwtTokenProvider.parse("stale")).thenReturn(claims);
        when(refreshTokenService.matches(1L, "stale")).thenReturn(false);

        assertThatThrownBy(() -> service.refresh("stale"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("다시 로그인");

        // 옛 토큰이 돌아다닌다는 건 탈취 신호다 — 남은 세션도 버린다
        verify(refreshTokenService).delete(1L);
    }

    @Test
    void anAccessTokenCannotBeUsedToRefresh() {
        Claims claims = mock(Claims.class);
        lenient().when(claims.getSubject()).thenReturn("1");
        when(claims.get(JwtTokenProvider.CLAIM_TYPE, String.class)).thenReturn("access");
        when(jwtTokenProvider.parse("access")).thenReturn(claims);

        assertThatThrownBy(() -> service.refresh("access"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("다시 로그인");
    }

    @Test
    void malformedRefreshTokenIsRejected() {
        when(jwtTokenProvider.parse("garbage")).thenThrow(new JwtException("bad"));

        assertThatThrownBy(() -> service.refresh("garbage"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("다시 로그인");
    }

    @Test
    void refreshFailsWhenTheAccountIsGone() {
        Claims claims = refreshClaims("1");
        when(jwtTokenProvider.parse("refresh")).thenReturn(claims);
        when(refreshTokenService.matches(1L, "refresh")).thenReturn(true);
        when(userRepository.findById(1L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.refresh("refresh"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("다시 로그인");
    }

    @Test
    void logoutDropsTheStoredRefresh() {
        service.logout(1L);

        verify(refreshTokenService).delete(1L);
    }

    @Test
    void meReturnsTheCurrentUser() {
        Optional<User> found = Optional.of(teacher());
        when(userRepository.findById(1L)).thenReturn(found);

        assertThat(service.me(1L).name()).isEqualTo("김선생");
    }

    @Test
    void meFailsForADeletedAccount() {
        when(userRepository.findById(1L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.me(1L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("사용자를 찾을 수 없습니다");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private Claims refreshClaims(String subject) {
        Claims claims = mock(Claims.class);
        lenient().when(claims.getSubject()).thenReturn(subject);
        lenient().when(claims.get(JwtTokenProvider.CLAIM_TYPE, String.class))
                .thenReturn(JwtTokenProvider.TYPE_REFRESH);
        return claims;
    }

    private User teacher() {
        User user = mock(User.class);
        lenient().when(user.getId()).thenReturn(1L);
        lenient().when(user.getName()).thenReturn("김선생");
        lenient().when(user.getPassword()).thenReturn("encoded");
        lenient().when(user.getRole()).thenReturn(Role.TEACHER);
        lenient().when(user.getUsername()).thenReturn("teacher@mallang.app");
        return user;
    }
}
