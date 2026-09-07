package com.mallang.invite.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.invite.dto.InviteDtos.AcceptInviteRequest;
import com.mallang.invite.dto.InviteDtos.AcceptInviteResponse;
import com.mallang.invite.dto.InviteDtos.CreateInviteRequest;
import com.mallang.invite.dto.InviteDtos.InvitePreviewResponse;
import com.mallang.invite.dto.InviteDtos.InviteResponse;
import com.mallang.invite.service.InvitePreviewService;
import com.mallang.invite.service.InviteService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Invite", description = "초대 — 발급/회수/수락")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class InviteController {

    private final InviteService inviteService;
    private final InvitePreviewService invitePreviewService;

    @Operation(summary = "초대 생성 (OWNER/MAINTAINER — 기본 maxUses: STUDENT 30 / TEACHER 1)")
    @PostMapping("/classrooms/{classroomId}/invites")
    public ResponseEntity<InviteResponse> create(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @Valid @RequestBody CreateInviteRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(inviteService.create(authUser, classroomId, request));
    }

    @Operation(summary = "유효한 초대 목록 (만료·회수·소진 제외)")
    @GetMapping("/classrooms/{classroomId}/invites")
    public List<InviteResponse> list(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return inviteService.list(authUser, classroomId);
    }

    @Operation(summary = "초대 즉시 회수 (코드 유출 대응)")
    @DeleteMapping("/invites/{inviteId}")
    public ResponseEntity<Void> revoke(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long inviteId) {
        inviteService.revoke(authUser, inviteId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "초대 코드 미리보기 (공개) — 학급명·타입·사용 가능 여부. 없는 코드만 404")
    @GetMapping("/invites/{code}")
    public InvitePreviewResponse preview(@PathVariable String code, HttpServletRequest request) {
        return invitePreviewService.preview(code, clientIp(request));
    }

    /**
     * 프록시(Nginx) 뒤라 원격 주소는 프록시 자신이다. X-Forwarded-For 의 첫 값이 실제 클라이언트고,
     * 뒤쪽은 중간 프록시들이라 앞에서 잘라 쓴다.
     */
    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    @Operation(summary = "초대 수락 — 선생님은 로그인 상태로, 학생은 계정 정보와 함께 (만료 시 410)")
    @PostMapping("/invites/{code}/accept")
    public AcceptInviteResponse accept(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable String code,
            @Valid @RequestBody(required = false) AcceptInviteRequest request) {
        return inviteService.accept(code, request, authUser);
    }
}
