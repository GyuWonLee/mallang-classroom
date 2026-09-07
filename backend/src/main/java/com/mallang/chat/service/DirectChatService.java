package com.mallang.chat.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.chat.dto.ChatDtos.DirectMessageRequest;
import com.mallang.chat.dto.ChatDtos.MessageResponse;
import com.mallang.chat.dto.ChatDtos.ThreadSummary;
import com.mallang.chat.entity.ChatMessage;
import com.mallang.chat.repository.ChatMessageRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 수업 밖 1:1 대화 (명세 §11.1 #3·#4).
 *
 * <p>CHAT_MESSAGE.session_id 가 NOT NULL 이던 시절엔 교사끼리의 대화를 저장할 자리가 없었고,
 * 읽음 컬럼이 없어 "안 읽은 것이 위" 정렬도 만들 수 없었다. V14 로 자리를 만들고 여기서 쓴다.</p>
 *
 * <p>대화의 문맥은 <b>학급</b>이다 — 같은 학급 구성원끼리만 주고받는다. 학교 전체 주소록이
 * 아니라 학급 운영 도구이기 때문이고, 권한 검증도 이 기준 하나로 끝난다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DirectChatService {

    /** 개인 알림함 — 수업 밖 대화라 세션 토픽이 없다 (TeacherRoomService 와 같은 자리). */
    private static final String PERSONAL_DESTINATION = "/sub/notifications";

    private final AssignmentAccessGuard accessGuard;
    private final ChatMessageRepository chatMessageRepository;
    private final ClassroomMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final SimpMessagingTemplate messagingTemplate;

    @Transactional
    public MessageResponse send(AuthUser sender, Long classroomId, DirectMessageRequest request) {
        accessGuard.requireMember(classroomId, sender.id());
        if (request.recipientId().equals(sender.id())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "cannot-message-self",
                    "자기 자신에게는 보낼 수 없습니다.");
        }
        memberRepository.findByClassroomIdAndUserId(classroomId, request.recipientId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not-a-member",
                        "받는 사람이 이 학급의 구성원이 아닙니다."));

        Classroom classroom = accessGuard.findClassroom(classroomId);
        ChatMessage saved = chatMessageRepository.save(ChatMessage.direct(
                classroom,
                userRepository.getReferenceById(sender.id()),
                userRepository.getReferenceById(request.recipientId()),
                request.content()));
        MessageResponse response = MessageResponse.from(saved);
        notifyRecipient(classroomId, request.recipientId(), response);
        return response;
    }

    /**
     * 받는 사람 화면에 지금 도착했다고 알린다.
     *
     * <p>없으면 쪽지는 <b>받는 사람이 쪽지함을 직접 열기 전까지 아무 데도 나타나지 않는다.</b>
     * 특히 말랑이가 아이 질문을 대신 전하는 경로가 수업이 안 열려 있을 때 여기로 내려오는데,
     * 아이에게는 "선생님 쪽지함에 남겼어요"라고 말해 놓고 정작 선생님은 알 길이 없었다.
     * 아이 쪽에 한 약속을 서버가 지키는 자리다.</p>
     *
     * <p>보낸 사람에게는 보내지 않는다 — REST 응답으로 이미 받았고, 두 번 그리면 중복된다.</p>
     *
     * <p><b>알림 실패로 저장을 되돌리지 않는다.</b> 쪽지는 이미 DB 에 남았고 쪽지함을 열면
     * 보인다. 여기서 예외를 던지면 잘 저장된 쪽지가 "실패"로 보여 사용자가 다시 보내게 된다.</p>
     */
    private void notifyRecipient(Long classroomId, Long recipientId, MessageResponse message) {
        try {
            messagingTemplate.convertAndSendToUser(String.valueOf(recipientId),
                    PERSONAL_DESTINATION,
                    StompEnvelope.of(StompEventType.DIRECT_MESSAGE,
                            Map.of("classroomId", classroomId, "message", message)));
        } catch (RuntimeException e) {
            log.warn("쪽지 도착 알림 실패 — 쪽지는 저장됐다. classroomId={}, recipientId={}",
                    classroomId, recipientId, e);
        }
    }

    /** 상대와 주고받은 것 전부 (오래된 것부터 — 대화창은 위에서 아래로 읽는다). */
    public List<MessageResponse> conversation(AuthUser viewer, Long classroomId, Long peerId) {
        accessGuard.requireMember(classroomId, viewer.id());
        return chatMessageRepository.findConversation(classroomId, viewer.id(), peerId).stream()
                .map(MessageResponse::from)
                .toList();
    }

    /**
     * 내 대화 목록 — 상대별로 접어서 마지막 메시지와 안 읽은 수를 담는다.
     * 정렬은 선생님 9 화면의 규칙 그대로: <b>안 읽은 것이 위, 그 안에서는 최근 것이 위</b>.
     */
    public List<ThreadSummary> myThreads(AuthUser viewer) {
        // 쿼리가 최근 순이므로 각 상대의 첫 등장이 곧 마지막 메시지다.
        Map<Long, ThreadAccumulator> byPeer = new LinkedHashMap<>();
        for (ChatMessage message : chatMessageRepository.findMyDirectMessages(viewer.id())) {
            boolean iSent = message.getSender().getId().equals(viewer.id());
            var peer = iSent ? message.getRecipient() : message.getSender();
            ThreadAccumulator thread = byPeer.computeIfAbsent(peer.getId(),
                    id -> new ThreadAccumulator(message.getClassroom().getId(), id, peer.getName(),
                            message.getContent(), message.getCreatedAt()));
            if (!iSent && message.getReadAt() == null) {
                thread.unread++;
            }
        }

        List<ThreadSummary> threads = new ArrayList<>(byPeer.size());
        byPeer.values().forEach(t -> threads.add(new ThreadSummary(
                t.classroomId, t.peerId, t.peerName, t.lastContent, t.lastAt, t.unread)));
        threads.sort(Comparator
                .comparing((ThreadSummary t) -> t.unreadCount() > 0).reversed()
                .thenComparing(ThreadSummary::lastAt, Comparator.reverseOrder()));
        return threads;
    }

    /** 상대가 나에게 보낸 것만 읽음으로 찍는다 (내가 보낸 것까지 찍으면 상대 표시가 거짓이 된다). */
    @Transactional
    public void markRead(AuthUser viewer, Long classroomId, Long peerId) {
        accessGuard.requireMember(classroomId, viewer.id());
        chatMessageRepository.markThreadRead(classroomId, peerId, viewer.id(), LocalDateTime.now());
    }

    /** 접는 동안만 쓰는 가변 누산기 — 응답 record 는 불변이라 카운트를 못 올린다. */
    private static final class ThreadAccumulator {
        private final Long classroomId;
        private final Long peerId;
        private final String peerName;
        private final String lastContent;
        private final LocalDateTime lastAt;
        private long unread;

        private ThreadAccumulator(Long classroomId, Long peerId, String peerName,
                                  String lastContent, LocalDateTime lastAt) {
            this.classroomId = classroomId;
            this.peerId = peerId;
            this.peerName = peerName;
            this.lastContent = lastContent;
            this.lastAt = lastAt;
        }
    }
}
