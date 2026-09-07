package com.mallang.session.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.SessionDtos.SessionResponse;
import com.mallang.session.dto.SessionDtos.SessionStateResponse;
import com.mallang.session.dto.SessionDtos.BoardGrantRequest;
import com.mallang.session.dto.SessionDtos.BroadcastLockRequest;
import com.mallang.session.dto.SessionDtos.JoinResponse;
import com.mallang.session.dto.SessionDtos.MediaControlRequest;
import com.mallang.session.dto.SessionDtos.SessionDetailResponse;
import com.mallang.session.dto.SessionDtos.SessionParticipantResponse;
import com.mallang.session.dto.SessionDtos.SessionTopicRequest;
import com.mallang.session.dto.SessionDtos.StartSessionRequest;
import com.mallang.session.dto.SessionDtos.TeamRoomToken;
import com.mallang.session.service.BoardGrantService;
import com.mallang.session.service.BroadcastLockService;
import com.mallang.session.service.MediaControlService;
import com.mallang.session.service.SessionKickService;
import com.mallang.session.service.SessionService;
import com.mallang.session.service.SessionTicketService;
import com.mallang.session.service.SessionTopicService;
import jakarta.validation.Valid;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Session", description = "수업 — 시작/종료")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class SessionController {

    private final SessionService sessionService;
    private final SessionTicketService sessionTicketService;
    private final BoardGrantService boardGrantService;
    private final BroadcastLockService broadcastLockService;
    private final MediaControlService mediaControlService;
    private final SessionKickService sessionKickService;
    private final SessionTopicService sessionTopicService;

    @Operation(summary = "수업 시작 (OWNER/MAINTAINER) — grade 를 주면 그 학년 수업이라 같은 학급의 "
            + "다른 학년 수업과 나란히 돌아간다. 같은 학년이 이미 열려 있으면 409. grade 를 비우면 "
            + "학급 전체 수업이라 그 학급에 다른 수업이 하나도 없어야 한다")
    @PostMapping("/classrooms/{classroomId}/sessions")
    public ResponseEntity<SessionResponse> start(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            // 본문 없이 부르던 기존 호출(학급 전체 수업)을 그대로 받으려고 required=false 다
            @Valid @RequestBody(required = false) StartSessionRequest request) {
        Short grade = request == null ? null : request.grade();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(SessionResponse.from(sessionService.start(classroomId, grade, authUser)));
    }

    @Operation(summary = "수업 이력 목록 — 최근 수업이 먼저, 진행중 수업도 포함 (멤버)")
    @GetMapping("/classrooms/{classroomId}/sessions")
    public List<SessionDetailResponse> history(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return sessionService.history(classroomId, authUser);
    }

    @Operation(summary = "수업 상세 — 종료된 수업도 조회 가능 (멤버). 실시간 상태는 /state")
    @GetMapping("/sessions/{sessionId}")
    public SessionDetailResponse detail(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId) {
        return sessionService.detail(sessionId, authUser);
    }

    @Operation(summary = "상태 스냅샷 — 접속/재접속 시 호출, 이후 STOMP 증분 갱신 (멤버)")
    @GetMapping("/sessions/{sessionId}/state")
    public SessionStateResponse state(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId) {
        return sessionService.state(sessionId, authUser);
    }

    @Operation(summary = "참가자 명단 (LiveKit identity 매칭용: 이름·역할·팀, 멤버 전용)")
    @GetMapping("/sessions/{sessionId}/participants")
    public List<SessionParticipantResponse> participants(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId) {
        return sessionService.participants(sessionId, authUser);
    }

    @Operation(summary = "Issue LiveKit tickets for the classroom room and the student's team room")
    @PostMapping("/sessions/{sessionId}/join")
    public JoinResponse join(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId) {
        return sessionTicketService.join(sessionId, authUser);
    }

    @Operation(summary = "학년별 수업 주제 저장 (빈 문자열은 삭제, 현재 수업 시작 선생님 전용)")
    @PutMapping("/sessions/{sessionId}/topics/{grade}")
    public ResponseEntity<Void> topic(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId,
            @PathVariable int grade,
            @Valid @RequestBody SessionTopicRequest request) {
        sessionTopicService.update(sessionId, grade, request, authUser);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "Issue a teacher ticket for visiting a team room")
    @PostMapping("/sessions/{sessionId}/teams/{teamId}/visit")
    public TeamRoomToken visit(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId,
            @PathVariable Long teamId) {
        return sessionTicketService.visit(sessionId, teamId, authUser);
    }

    @Operation(summary = "판서 권한 부여/회수 (OWNER/MAINTAINER — BOARD_GRANT 방송)")
    @PostMapping("/sessions/{sessionId}/board/grants")
    public ResponseEntity<Void> boardGrants(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId,
            @Valid @RequestBody BoardGrantRequest request) {
        boardGrantService.updateGrants(sessionId, request, authUser);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "학생 방송 영역 쉬는 시간 잠금/해제 (현재 수업 시작 선생님 전용)")
    @PutMapping("/sessions/{sessionId}/broadcast-lock")
    public ResponseEntity<Void> broadcastLock(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId,
            @Valid @RequestBody BroadcastLockRequest request) {
        broadcastLockService.update(sessionId, request, authUser);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "학생 개인·팀·전체 마이크·카메라 잠금/해제 (현재 수업 시작 선생님 전용)")
    @PostMapping("/sessions/{sessionId}/media-controls")
    public ResponseEntity<Void> mediaControls(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId,
            @Valid @RequestBody MediaControlRequest request) {
        mediaControlService.control(sessionId, request, authUser);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "수업 중 강퇴 (현재 수업 시작 선생님 전용 — 재입장 차단·KICKED 방송)")
    @PostMapping("/sessions/{sessionId}/participants/{userId}/kick")
    public ResponseEntity<Void> kick(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId,
            @PathVariable Long userId) {
        sessionKickService.kick(sessionId, userId, authUser);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "수업 종료 (배정 종료·대기열 정리·상태 삭제·SESSION_ENDED 방송 포함)")
    @PostMapping("/sessions/{sessionId}/end")
    public ResponseEntity<Void> end(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId) {
        sessionService.end(sessionId, authUser);
        return ResponseEntity.noContent().build();
    }
}
