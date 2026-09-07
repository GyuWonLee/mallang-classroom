package com.mallang.invite.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.global.error.ApiException;
import com.mallang.invite.dto.InviteDtos.InvitePreviewResponse;
import com.mallang.invite.entity.Invite;
import com.mallang.invite.entity.InviteType;
import com.mallang.invite.repository.InviteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 초대 코드 미리보기 — S15P11A407-137
 *
 * <p>지금까지는 수락 API 뿐이라 학생이 가입 폼을 다 채워 제출한 뒤에야 만료를 알았다.
 * 저학년이 쓰는 화면이라 그 실패 경험이 특히 비싸다.</p>
 *
 * <p>공개 엔드포인트이므로 코드 열거 방어(레이트리밋)를 반드시 거친다 — 여기서 검증하는
 * 두 번째 축이 그것이다.</p>
 */
@ExtendWith(MockitoExtension.class)
class InvitePreviewServiceTest {

    private static final String CODE = "ABC234";
    private static final String IP = "203.0.113.7";

    @Mock InviteRepository inviteRepository;
    @Mock InviteCodeRateLimiter rateLimiter;

    private InvitePreviewService service;

    @BeforeEach
    void setUp() {
        service = new InvitePreviewService(inviteRepository, rateLimiter);
    }

    @Test
    void showsClassroomNameAndTypeForUsableCode() {
        found(invite(InviteType.STUDENT, LocalDateTime.now().plusHours(1), 30, 0, null));

        InvitePreviewResponse preview = service.preview(CODE, IP);

        // 어느 학급 초대인지 보여줘야 학생이 "내 반이 맞나"를 확인할 수 있다
        assertThat(preview.classroomName()).isEqualTo("2학년 3반");
        assertThat(preview.type()).isEqualTo("STUDENT");
        assertThat(preview.usable()).isTrue();
        assertThat(preview.reason()).isNull();
    }

    @Test
    void expiredCodeIsReportedBeforeTheFormIsFilled() {
        found(invite(InviteType.STUDENT, LocalDateTime.now().minusHours(1), 30, 0, null));

        InvitePreviewResponse preview = service.preview(CODE, IP);

        // 200 으로 내려준다 — 폼을 막되 화면은 "만료됐어요"를 그릴 수 있어야 한다
        assertThat(preview.usable()).isFalse();
        assertThat(preview.reason()).isEqualTo("EXPIRED");
        assertThat(preview.classroomName()).isEqualTo("2학년 3반");
    }

    @Test
    void revokedCodeIsReported() {
        found(invite(InviteType.STUDENT, LocalDateTime.now().plusHours(1), 30, 0,
                LocalDateTime.now().minusMinutes(5)));

        assertThat(service.preview(CODE, IP).reason()).isEqualTo("REVOKED");
    }

    @Test
    void usedUpCodeIsReported() {
        found(invite(InviteType.STUDENT, LocalDateTime.now().plusHours(1), 30, 30, null));

        assertThat(service.preview(CODE, IP).reason()).isEqualTo("USED_UP");
    }

    @Test
    void unknownCodeIs404() {
        when(inviteRepository.findByCode(CODE)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.preview(CODE, IP))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("초대 코드를 찾을 수 없습니다");
    }

    @Test
    void everyLookupGoesThroughTheRateLimiter() {
        found(invite(InviteType.STUDENT, LocalDateTime.now().plusHours(1), 30, 0, null));

        service.preview(CODE, IP);

        // 코드 열거를 막는 유일한 장치다 — 조회 전에 반드시 거쳐야 한다
        verify(rateLimiter).check(IP);
    }

    @Test
    void rateLimitedCallerNeverReachesTheDatabase() {
        org.mockito.Mockito.doThrow(new ApiException(
                        org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                        "too-many-requests", "잠시 후 다시 시도해 주세요."))
                .when(rateLimiter).check(IP);

        assertThatThrownBy(() -> service.preview(CODE, IP))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("잠시 후");

        verify(inviteRepository, org.mockito.Mockito.never()).findByCode(CODE);
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void found(Invite invite) {
        Optional<Invite> result = Optional.of(invite);
        when(inviteRepository.findByCode(CODE)).thenReturn(result);
    }

    private Invite invite(InviteType type, LocalDateTime expiresAt, int maxUses,
                          int usedCount, LocalDateTime revokedAt) {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getName()).thenReturn("2학년 3반");
        Invite invite = mock(Invite.class);
        lenient().when(invite.getClassroom()).thenReturn(classroom);
        lenient().when(invite.getType()).thenReturn(type);
        lenient().when(invite.getExpiresAt()).thenReturn(expiresAt);
        lenient().when(invite.getMaxUses()).thenReturn(maxUses);
        lenient().when(invite.getUsedCount()).thenReturn(usedCount);
        lenient().when(invite.getRevokedAt()).thenReturn(revokedAt);
        return invite;
    }
}
