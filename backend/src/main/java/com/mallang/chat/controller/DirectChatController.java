package com.mallang.chat.controller;

import com.mallang.chat.dto.ChatDtos.DirectMessageRequest;
import com.mallang.chat.dto.ChatDtos.MessageResponse;
import com.mallang.chat.dto.ChatDtos.ThreadSummary;
import com.mallang.chat.service.DirectChatService;
import com.mallang.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "DirectChat", description = "수업 밖 1:1 대화 — 교사 간 메시지·읽음")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class DirectChatController {

    private final DirectChatService directChatService;

    @Operation(summary = "내 대화 목록 — 안 읽은 것이 위, 그 안에서는 최근 것이 위")
    @GetMapping("/me/chat/threads")
    public List<ThreadSummary> myThreads(@AuthenticationPrincipal AuthUser authUser) {
        return directChatService.myThreads(authUser);
    }

    @Operation(summary = "수업 밖 1:1 메시지 전송 (같은 학급 구성원에게만)")
    @PostMapping("/classrooms/{classroomId}/chat/messages")
    public ResponseEntity<MessageResponse> send(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @Valid @RequestBody DirectMessageRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(directChatService.send(authUser, classroomId, request));
    }

    @Operation(summary = "상대와의 대화 (양방향, 오래된 것부터)")
    @GetMapping("/classrooms/{classroomId}/chat/threads/{peerId}")
    public List<MessageResponse> conversation(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long peerId) {
        return directChatService.conversation(authUser, classroomId, peerId);
    }

    @Operation(summary = "스레드 읽음 처리 — 상대가 나에게 보낸 것만 찍힌다")
    @PostMapping("/classrooms/{classroomId}/chat/threads/{peerId}/read")
    public ResponseEntity<Void> markRead(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long peerId) {
        directChatService.markRead(authUser, classroomId, peerId);
        return ResponseEntity.noContent().build();
    }
}
