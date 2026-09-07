package com.mallang.chat.entity;

import com.mallang.classroom.entity.Classroom;
import com.mallang.session.entity.LiveSession;
import com.mallang.user.entity.User;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 대화 한 줄. 두 갈래가 한 표에 산다 (V14).
 *
 * <ul>
 *   <li><b>수업 채팅</b> — session 이 있다. 학생이 보내는 쪽은 recipient 가 비어 있고(대기열이
 *       나중에 정한다), <b>선생님이 보내는 쪽은 recipient 가 있다</b> — 배정된 학생 한 명이다.</li>
 *   <li><b>수업 밖 1:1</b> — session 이 비고 recipient 가 있다. 쪽지가 여기 속한다.</li>
 * </ul>
 *
 * <p><b>계통을 가르는 것은 session 이지 recipient 가 아니다.</b> 예전에는 수업 채팅이
 * recipient 를 아예 안 써서 {@code recipient is not null} 이 사실상 계통 판별자로 쓰였는데,
 * 그건 우연이었다. 선생님 메시지에 수신자를 적기 시작한 지금은 그 판별이 틀린다 —
 * 쪽지 쿼리는 반드시 {@code session is null} 로 가려야 한다(ChatMessageRepository).</p>
 *
 * <p>왜 선생님 쪽만 적는가: 학생이 보낼 때는 받을 사람이 아직 정해지지 않을 수 있다(대기열).
 * 반면 선생님은 <b>배정된 학생에게만</b> 보낼 수 있어 발행 시점에 수신자가 확정돼 있다.
 * 그리고 학생 자신의 메시지는 sender 로 이미 찾을 수 있어 수신자가 없어도 잃어버리지 않는다.</p>
 *
 * <p>classroom 은 항상 있다 — 대화의 문맥이자 권한 검증의 기준이다.
 * readAt 은 <b>쪽지</b>에서만 의미가 있다(수업 채팅의 읽음은 추적하지 않는다).</p>
 */
@Entity
@Table(name = "chat_message")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChatMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    /** 수업 밖 1:1 이면 null. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id")
    private LiveSession session;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sender_id", nullable = false)
    private User sender;

    /** 학생이 보낸 수업 채팅이면 null (받을 사람을 대기열이 나중에 정한다). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recipient_id")
    private User recipient;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "reply_to_id")
    private ChatMessage replyTo;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(name = "read_at")
    private LocalDateTime readAt;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** 수업 중 채팅 — 학생이 보내는 쪽. 받을 선생님은 아직 정해지지 않았을 수 있다. */
    public static ChatMessage of(LiveSession session, User sender, String content,
                                 ChatMessage replyTo) {
        return of(session, sender, null, content, replyTo);
    }

    /**
     * 수업 중 채팅 — 수신자를 적는다. 선생님이 배정된 학생에게 보내는 경로가 쓴다.
     *
     * <p>수신자를 적지 않으면 그 메시지는 <b>DB 에서 학생과 이어지지 않는다.</b> 답장이면
     * replyTo 를 타고 학생에게 닿지만, 답장이 아닌 메시지({@code replyToId} 없이 발행된 것)는
     * 아무 단서도 남지 않아 학생의 이력 조회에도, 선생님의 스레드 조회에도 걸리지 않았다.
     * 실시간으로는 전달되므로 그 순간엔 보이지만 새로고침하면 사라진다.
     */
    public static ChatMessage of(LiveSession session, User sender, User recipient, String content,
                                 ChatMessage replyTo) {
        ChatMessage message = new ChatMessage();
        message.session = session;
        message.classroom = session.getClassroom();
        message.sender = sender;
        message.recipient = recipient;
        message.content = content;
        message.replyTo = replyTo;
        message.createdAt = LocalDateTime.now();
        return message;
    }

    /** 수업 밖 1:1 — 수업이 없으므로 학급을 직접 받는다. */
    public static ChatMessage direct(Classroom classroom, User sender, User recipient,
                                     String content) {
        ChatMessage message = new ChatMessage();
        message.classroom = classroom;
        message.sender = sender;
        message.recipient = recipient;
        message.content = content;
        message.createdAt = LocalDateTime.now();
        return message;
    }

    /**
     * 학급 교사 단톡방 — 받는 사람을 지정하지 않는다.
     *
     * <p>세 종류의 메시지를 한 테이블에 담으면서 조합으로 구분한다:
     * 수업 채팅은 {@code session} 이 있고, 1:1 은 {@code recipient} 가 있으며,
     * 단톡방은 <b>둘 다 없다</b>. 지금까지 비어 있던 조합이라 기존 조회에 걸리지 않는다
     * — 수업 채팅 조회는 session 으로, 1:1 조회는 recipient 로 좁히기 때문이다.</p>
     *
     * <p>읽음은 {@code readAt} 으로 표시하지 않는다. 행 하나에 읽은 사람이 여럿이라
     * 담을 수 없다 — 사람별 마지막 읽은 시각을 {@code teacher_room_read} 에 따로 둔다.</p>
     */
    public static ChatMessage teacherRoom(Classroom classroom, User sender, String content) {
        ChatMessage message = new ChatMessage();
        message.classroom = classroom;
        message.sender = sender;
        message.content = content;
        message.createdAt = LocalDateTime.now();
        return message;
    }

    /** 이미 읽은 메시지는 시각을 덮어쓰지 않는다 — 처음 읽은 때가 읽은 때다. */
    public void markRead() {
        if (readAt == null) {
            readAt = LocalDateTime.now();
        }
    }
}
