package com.mallang.chat.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.chat.dto.ChatDtos.DirectMessageRequest;
import com.mallang.chat.dto.ChatDtos.MessageResponse;
import com.mallang.chat.dto.ChatDtos.ThreadSummary;
import com.mallang.chat.entity.ChatMessage;
import com.mallang.chat.repository.ChatMessageRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 수업 밖 1:1 대화 + 읽음 — S15P11A407-137
 *
 * <p>CHAT_MESSAGE.session_id 가 NOT NULL 이라 교사끼리의 대화는 저장할 자리가 없었고(§11.1 #3),
 * 읽음 컬럼이 없어 "안 읽은 것이 위" 정렬도 만들 수 없었다(#4).</p>
 *
 * <p>대화의 문맥은 학급이다 — 같은 학급에 속하지 않은 사람에게는 보낼 수 없다.</p>
 */
@ExtendWith(MockitoExtension.class)
class DirectChatServiceTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long ME = 1L;
    private static final Long PEER = 2L;

    @Mock AssignmentAccessGuard accessGuard;
    @Mock ChatMessageRepository chatMessageRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock UserRepository userRepository;
    @Mock SimpMessagingTemplate messagingTemplate;

    private DirectChatService service;

    @BeforeEach
    void setUp() {
        service = new DirectChatService(accessGuard, chatMessageRepository, memberRepository,
                userRepository, messagingTemplate);
    }

    @Test
    void teacherSendsAMessageToAnotherTeacher() {
        bothInClassroom();
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(any())).thenReturn(mock(User.class));
        when(chatMessageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.send(teacher(), CLASSROOM_ID, new DirectMessageRequest(PEER, "오늘 3반 회의 있나요?"));

        ArgumentCaptor<ChatMessage> captor = ArgumentCaptor.forClass(ChatMessage.class);
        verify(chatMessageRepository).save(captor.capture());
        ChatMessage saved = captor.getValue();
        // 수업 밖 대화라 수업은 비고 수신자가 있다 — 수업 채팅과 정반대 모양이다
        assertThat(saved.getSession()).isNull();
        assertThat(saved.getRecipient()).isNotNull();
        assertThat(saved.getContent()).isEqualTo("오늘 3반 회의 있나요?");
        assertThat(saved.getReadAt()).isNull();
    }

    @Test
    void cannotMessageSomeoneOutsideTheClassroom() {
        when(accessGuard.requireMember(CLASSROOM_ID, ME)).thenReturn(ClassroomRole.OWNER);
        when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, PEER))
                .thenReturn(Optional.empty());

        // 학급이 대화의 문맥이다 — 문맥 밖으로는 보낼 수 없다
        assertThatThrownBy(() -> service.send(teacher(), CLASSROOM_ID,
                new DirectMessageRequest(PEER, "안녕하세요")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원");

        verify(chatMessageRepository, never()).save(any());
    }

    @Test
    void cannotMessageYourself() {
        when(accessGuard.requireMember(CLASSROOM_ID, ME)).thenReturn(ClassroomRole.OWNER);

        assertThatThrownBy(() -> service.send(teacher(), CLASSROOM_ID,
                new DirectMessageRequest(ME, "혼잣말")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("자기 자신");
    }

    @Test
    void threadListPutsUnreadFirstThenNewest() {
        // 최근 것부터 내려온다 (쿼리 정렬). 3번과는 다 읽었고, 2번·4번에는 안 읽은 게 있다
        List<ChatMessage> messages = List.of(
                received(3L, "다 읽은 대화", now(10), true),
                received(2L, "안 읽은 대화", now(30), false),
                received(2L, "그 앞 메시지", now(40), false),
                received(4L, "더 오래된 안 읽음", now(60), false));
        when(chatMessageRepository.findMyDirectMessages(ME)).thenReturn(messages);

        List<ThreadSummary> threads = service.myThreads(teacher());

        // 선생님 9 화면의 정렬 규칙: 안 읽은 것이 위, 그 안에서는 최근 것이 위
        assertThat(threads).extracting(ThreadSummary::peerId).containsExactly(2L, 4L, 3L);
        assertThat(threads.get(0).unreadCount()).isEqualTo(2);
        assertThat(threads.get(2).unreadCount()).isZero();
    }

    @Test
    void threadPreviewIsTheLatestMessageEvenIfISentIt() {
        List<ChatMessage> messages = List.of(
                sent(2L, "제가 마지막으로 보냄", now(5)),
                received(2L, "상대가 먼저 보냄", now(50), true));
        when(chatMessageRepository.findMyDirectMessages(ME)).thenReturn(messages);

        List<ThreadSummary> threads = service.myThreads(teacher());

        assertThat(threads).hasSize(1);
        assertThat(threads.get(0).lastContent()).isEqualTo("제가 마지막으로 보냄");
        // 내가 보낸 것은 "안 읽음"으로 세지 않는다
        assertThat(threads.get(0).unreadCount()).isZero();
    }

    @Test
    void readingAThreadMarksOnlyMessagesSentToMe() {
        when(accessGuard.requireMember(CLASSROOM_ID, ME)).thenReturn(ClassroomRole.OWNER);

        service.markRead(teacher(), CLASSROOM_ID, PEER);

        // 내가 보낸 것까지 읽음 처리하면 상대의 읽음 표시가 거짓이 된다
        verify(chatMessageRepository).markThreadRead(
                org.mockito.ArgumentMatchers.eq(CLASSROOM_ID),
                org.mockito.ArgumentMatchers.eq(PEER),
                org.mockito.ArgumentMatchers.eq(ME),
                any());
    }

    @Test
    void conversationShowsBothDirections() {
        when(accessGuard.requireMember(CLASSROOM_ID, ME)).thenReturn(ClassroomRole.OWNER);
        List<ChatMessage> messages = List.of(message(ME, PEER, "제가 보냄"),
                message(PEER, ME, "상대가 보냄"));
        when(chatMessageRepository.findConversation(CLASSROOM_ID, ME, PEER)).thenReturn(messages);

        List<MessageResponse> conversation =
                service.conversation(teacher(), CLASSROOM_ID, PEER);

        // 한쪽만 보이면 대화가 아니다
        assertThat(conversation).hasSize(2);
        assertThat(conversation).extracting(MessageResponse::content)
                .containsExactly("제가 보냄", "상대가 보냄");
    }

    @Test
    void nonMemberCannotReadAConversation() {
        when(accessGuard.requireMember(CLASSROOM_ID, ME))
                .thenThrow(new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,
                        "not-a-member", "이 학급의 구성원이 아닙니다."));

        assertThatThrownBy(() -> service.conversation(teacher(), CLASSROOM_ID, PEER))
                .isInstanceOf(ApiException.class);
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void bothInClassroom() {
        lenient().when(accessGuard.requireMember(CLASSROOM_ID, ME)).thenReturn(ClassroomRole.OWNER);
        Optional<com.mallang.classroom.entity.ClassroomMember> peer =
                Optional.of(mock(com.mallang.classroom.entity.ClassroomMember.class));
        lenient().when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, PEER))
                .thenReturn(peer);
    }

    private LocalDateTime now(int minutesAgo) {
        return LocalDateTime.of(2026, 8, 1, 12, 0).minusMinutes(minutesAgo);
    }

    /** 상대가 나에게 보낸 메시지. read=false 면 안 읽은 것. */
    private ChatMessage received(Long peerId, String content, LocalDateTime at, boolean read) {
        ChatMessage m = stamped(message(peerId, ME, content), at);
        if (read) {
            m.markRead();
        }
        return m;
    }

    /** 내가 상대에게 보낸 메시지 — 읽음 카운트에 들어가면 안 된다. */
    private ChatMessage sent(Long peerId, String content, LocalDateTime at) {
        return stamped(message(ME, peerId, content), at);
    }

    /**
     * createdAt 은 엔티티가 now() 로 박아서 테스트에서 시각을 정할 수 없다.
     * 목록 정렬·미리보기를 검증하려면 시각이 통제돼야 하므로 리플렉션으로 바꿔 끼운다.
     */
    private ChatMessage stamped(ChatMessage message, LocalDateTime at) {
        try {
            var field = ChatMessage.class.getDeclaredField("createdAt");
            field.setAccessible(true);
            field.set(message, at);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        return message;
    }

    private ChatMessage message(Long senderId, Long recipientId, String content) {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(CLASSROOM_ID);
        User sender = mock(User.class);
        lenient().when(sender.getId()).thenReturn(senderId);
        lenient().when(sender.getName()).thenReturn("사람" + senderId);
        User recipient = mock(User.class);
        lenient().when(recipient.getId()).thenReturn(recipientId);
        lenient().when(recipient.getName()).thenReturn("사람" + recipientId);
        return ChatMessage.direct(classroom, sender, recipient, content);
    }

    private AuthUser teacher() {
        return new AuthUser(ME, Role.TEACHER, "김선생");
    }

    /**
     * 쪽지를 받는 사람에게 <b>도착했다고 알린다.</b>
     *
     * <p>이게 없던 동안 쪽지는 받는 사람이 쪽지함을 직접 열기 전까지 아무 데도 안 나타났다.
     * 말랑이가 아이 질문을 대신 전하는 경로가 수업이 안 열려 있을 때 여기로 내려오는데,
     * 아이 화면은 "선생님 쪽지함에 남겼어요"라고 말해 둔 뒤였다.</p>
     */
    @Test
    void theRecipientIsNotifiedThatAMessageArrived() {
        bothInClassroom();
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(any())).thenReturn(mock(User.class));
        when(chatMessageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.send(teacher(), CLASSROOM_ID, new DirectMessageRequest(PEER, "질문이 있어요"));

        // 받는 사람 개인 채널로만 — 보낸 사람은 REST 응답으로 이미 받았다
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq(String.valueOf(PEER)), eq("/sub/notifications"), payload.capture());
        assertThat(payload.getValue()).isInstanceOf(StompEnvelope.class);
        assertThat(((StompEnvelope) payload.getValue()).type())
                .isEqualTo(StompEventType.DIRECT_MESSAGE);
        verify(messagingTemplate, never())
                .convertAndSendToUser(eq(String.valueOf(ME)), any(), any());
    }

    /**
     * 알림이 실패해도 쪽지는 보내진 것이다.
     *
     * <p>여기서 예외가 새어 나가면 <b>DB 에 잘 저장된 쪽지가 화면에는 "실패"로 보인다.</b>
     * 그러면 사용자가 같은 말을 다시 보내고, 받는 쪽에는 두 번 남는다. 통지표 메일에서
     * 이미 같은 모양의 문제를 겪었다 — 메일은 갔는데 사이트는 실패라고 했다.</p>
     */
    @Test
    void aFailedNotificationDoesNotFailTheSend() {
        bothInClassroom();
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(any())).thenReturn(mock(User.class));
        when(chatMessageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        doThrow(new IllegalStateException("broker down"))
                .when(messagingTemplate).convertAndSendToUser(any(), any(), any(Object.class));

        MessageResponse sent =
                service.send(teacher(), CLASSROOM_ID, new DirectMessageRequest(PEER, "질문이 있어요"));

        assertThat(sent.content()).isEqualTo("질문이 있어요");
        verify(chatMessageRepository).save(any());
    }
}
