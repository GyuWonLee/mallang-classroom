package com.mallang.invite.dto;

import com.mallang.invite.entity.Invite;
import com.mallang.invite.entity.InviteType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;

/** 초대 도메인 DTO — 프론트 types/invite.ts 와 shape 일치 */
public class InviteDtos {

    public record CreateInviteRequest(
            @NotNull InviteType type,
            @Min(1) @Max(720) Integer expiresInHours,
            @Min(1) @Max(200) Integer maxUses
    ) {}

    public record InviteResponse(
            Long id,
            String code,
            String type,
            int maxUses,
            int usedCount,
            LocalDateTime expiresAt,
            LocalDateTime revokedAt
    ) {
        public static InviteResponse from(Invite invite) {
            return new InviteResponse(invite.getId(), invite.getCode(), invite.getType().name(),
                    invite.getMaxUses(), invite.getUsedCount(), invite.getExpiresAt(),
                    invite.getRevokedAt());
        }
    }

    /**
     * 초대 코드 미리보기 (공개). 가입 폼을 채우기 전에 "어느 학급인지 · 지금 쓸 수 있는지"를 보여준다.
     *
     * <p>못 쓰는 코드도 200 으로 내려간다 — reason 이 있으면 폼을 막고 안내 문구를 띄우면 된다.
     * reason: REVOKED(회수) · EXPIRED(만료) · USED_UP(정원 소진), 쓸 수 있으면 null.</p>
     */
    public record InvitePreviewResponse(
            String classroomName,
            String type,
            boolean usable,
            String reason
    ) {}

    /**
     * 초대 수락. 선생님은 로그인 상태로 코드만 있으면 되고(본문 불필요),
     * 학생은 계정 정보를 함께 보낸다 (아이디는 서버가 발급).
     */
    public record AcceptInviteRequest(
            @Size(max = 30) String name,
            @Min(1) @Max(6) Short grade,
            @Size(max = 50) String school,
            @Size(min = 4, max = 64) String password
    ) {}

    /**
     * 수락 결과. username 은 STUDENT 초대에서만 채워진다 —
     * 서버가 발급한 아이디이므로 학생에게 보여줘야 로그인할 수 있다.
     */
    public record AcceptInviteResponse(
            Long classroomId,
            String classroomName,
            String role,
            String username
    ) {}
}
