package com.mallang.chat.controller;

import com.mallang.chat.dto.ChatDtos.MessageResponse;
import com.mallang.chat.service.ChatQueryService;
import com.mallang.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 채팅 이력 조회 (명세 §6). 전송은 STOMP(ChatController), 여기는 REST 조회 전용 */
@Tag(name = "Chat", description = "채팅 — 이력 조회")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ChatRestController {

    private final ChatQueryService chatQueryService;

    @Operation(summary = "수업 내 메시지 목록 (선생님, ?studentId= 필터 선택)")
    @GetMapping("/sessions/{sessionId}/messages")
    public List<MessageResponse> sessionMessages(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId,
            @RequestParam(required = false) Long studentId) {
        return chatQueryService.sessionMessages(sessionId, studentId, authUser);
    }

    @Operation(summary = "특정 학생과의 대화 스레드 (선생님 or 본인)")
    @GetMapping("/sessions/{sessionId}/messages/threads/{studentId}")
    public List<MessageResponse> thread(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long sessionId,
            @PathVariable Long studentId) {
        return chatQueryService.thread(sessionId, studentId, authUser);
    }

    @Operation(summary = "내가 보낸 메시지와 답장 (학생)")
    @GetMapping("/me/messages")
    public List<MessageResponse> myMessages(@AuthenticationPrincipal AuthUser authUser) {
        return chatQueryService.myMessages(authUser);
    }
}
