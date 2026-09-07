package com.mallang.chat.controller;

import com.mallang.chat.service.ChatRouterService;
import com.mallang.global.security.AuthUser;
import com.mallang.global.security.StompPrincipals;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Controller;

import java.security.Principal;

/**
 * 채팅 발행 투입구 (명세 섹션 10).
 * 학생: /pub/sessions/{id}/messages · 교사: /pub/sessions/{id}/messages/reply
 */
@Controller
@RequiredArgsConstructor
public class ChatController {

    private final ChatRouterService chatRouterService;

    public record ChatSendRequest(String content) {}

    public record ChatReplyRequest(Long studentId, String content, Long replyToId) {}

    @MessageMapping("/sessions/{sessionId}/messages")
    public void send(@DestinationVariable Long sessionId, ChatSendRequest request, Principal principal) {
        AuthUser user = StompPrincipals.authUser(principal);
        if (user.isTeacher()) {
            throw new AccessDeniedException("학생 전용 발행 주소입니다");
        }
        chatRouterService.routeStudentMessage(sessionId, user.id(), request.content());
    }

    @MessageMapping("/sessions/{sessionId}/messages/reply")
    public void reply(@DestinationVariable Long sessionId, ChatReplyRequest request, Principal principal) {
        AuthUser user = StompPrincipals.authUser(principal);
        if (!user.isTeacher()) {
            throw new AccessDeniedException("교사 전용 발행 주소입니다");
        }
        chatRouterService.routeTeacherReply(
                sessionId, user.id(), request.studentId(), request.content(), request.replyToId());
    }
}
