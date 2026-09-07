package com.mallang.chat.dto;

import com.mallang.chat.entity.ChatMessage;
import com.mallang.user.entity.Role;

import java.time.LocalDateTime;

public class ChatDtos {

    /**
     * sessionId 는 쪽지면 null 이다 (V14).
     *
     * <p><b>senderRole 은 클라이언트가 발신자를 되짚을 때 쓰라고 있는 값이다.</b> 이 필드가
     * 없던 동안 프론트는 {@code replyToId} 유무로 "답장이면 선생님"이라고 추정했는데
     * (services/api/chatApi.ts), 답장 형식이 아닌 선생님 메시지에는 그 추정이 틀려서
     * <b>선생님 말이 아이 말풍선으로</b> 그려졌다. 발신자를 추정으로 알아내게 두면 안 된다.
     *
     * <p>recipientId 는 수업 채팅에서 선생님이 보낸 것과 쪽지에만 있다. 학생이 보낸 수업
     * 채팅은 받을 사람이 아직 정해지지 않아 null 이다.
     */
    public record MessageResponse(Long id, Long sessionId, Long senderId, String senderName,
                                  Role senderRole, Long recipientId,
                                  Long replyToId, String content, LocalDateTime createdAt) {

        public static MessageResponse from(ChatMessage message) {
            return new MessageResponse(
                    message.getId(),
                    message.getSession() == null ? null : message.getSession().getId(),
                    message.getSender().getId(),
                    message.getSender().getName(),
                    message.getSender().getRole(),
                    message.getRecipient() == null ? null : message.getRecipient().getId(),
                    message.getReplyTo() == null ? null : message.getReplyTo().getId(),
                    message.getContent(),
                    message.getCreatedAt());
        }
    }

    /** 수업 밖 1:1 메시지 전송 — 받는 사람은 같은 학급 구성원이어야 한다. */
    public record DirectMessageRequest(
            @jakarta.validation.constraints.NotNull Long recipientId,
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = 2000) String content
    ) {}

    /**
     * 대화 목록의 한 줄 (선생님 9 화면). unreadCount 는 "나에게 온 것 중 안 읽은 수"다 —
     * 내가 보낸 것은 세지 않는다.
     */
    public record ThreadSummary(
            Long classroomId,
            Long peerId,
            String peerName,
            String lastContent,
            LocalDateTime lastAt,
            long unreadCount
    ) {}

    /** 교사 단톡방 전송 — 받는 사람이 없다. 학급이 곧 방이다. */
    public record TeacherRoomRequest(
            @jakarta.validation.constraints.NotBlank
            @jakarta.validation.constraints.Size(max = 2000) String content
    ) {}

    /**
     * 단톡방 요약 — 목록 화면이 방 전체를 불러오지 않게 한다.
     * {@code lastMessage} 는 아직 아무도 말하지 않았으면 null 이다.
     */
    public record TeacherRoomSummary(
            Long classroomId,
            MessageResponse lastMessage,
            long unreadCount
    ) {}
}
