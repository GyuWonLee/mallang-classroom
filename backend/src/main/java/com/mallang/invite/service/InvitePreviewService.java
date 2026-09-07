package com.mallang.invite.service;

import com.mallang.global.error.ApiException;
import com.mallang.invite.dto.InviteDtos.InvitePreviewResponse;
import com.mallang.invite.entity.Invite;
import com.mallang.invite.repository.InviteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 초대 코드 미리보기 (명세 §11.1 #2) — 공개.
 *
 * <p>수락 API 밖에 없던 탓에 학생은 가입 폼을 다 채워 제출한 뒤에야 만료를 알았고,
 * 어느 학급 초대인지도 확인할 수 없었다. 저학년이 쓰는 화면이라 그 실패가 비싸다.</p>
 *
 * <p>못 쓰는 코드도 200 으로 내려준다 — 화면이 "만료됐어요"를 그리려면 사유가 필요하고,
 * 4xx 로 던지면 프론트가 에러 처리로 빠져 학급명조차 못 띄운다. 존재하지 않는 코드만 404.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class InvitePreviewService {

    private final InviteRepository inviteRepository;
    private final InviteCodeRateLimiter rateLimiter;

    public InvitePreviewResponse preview(String code, String clientIp) {
        // 조회 전에 막는다 — 통과시킨 뒤 세면 열거 시도가 그대로 DB 부하가 된다.
        rateLimiter.check(clientIp);

        Invite invite = inviteRepository.findByCode(code)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "invite-not-found",
                        "초대 코드를 찾을 수 없습니다."));

        String reason = unusableReason(invite, LocalDateTime.now());
        return new InvitePreviewResponse(
                invite.getClassroom().getName(),
                invite.getType().name(),
                reason == null,
                reason);
    }

    /**
     * 못 쓰는 사유. 회수 → 만료 → 소진 순으로 본다 (여러 개가 겹치면 더 결정적인 쪽을 알린다).
     * 쓸 수 있으면 null.
     */
    private String unusableReason(Invite invite, LocalDateTime now) {
        if (invite.getRevokedAt() != null) {
            return "REVOKED";
        }
        if (!invite.getExpiresAt().isAfter(now)) {
            return "EXPIRED";
        }
        if (invite.getUsedCount() >= invite.getMaxUses()) {
            return "USED_UP";
        }
        return null;
    }
}
