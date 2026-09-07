package com.mallang.chat.repository;

import com.mallang.chat.entity.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 한 표에 두 계통이 산다 — 수업 채팅(session 있음)과 쪽지(session 없음).
 *
 * <p><b>계통을 가르는 조건은 {@code session} 이다.</b> 예전에는 수업 채팅이 recipient 를 아예
 * 쓰지 않아 {@code recipient is not null} 만으로도 쪽지가 걸러졌고, 아래 쿼리들이 그 우연에
 * 기대고 있었다. 선생님 메시지에 수신자를 적기 시작한 지금 그 조건은 더 이상 계통을 가르지
 * 못한다 — 쪽지 쿼리에는 {@code m.session is null} 이, 수업 채팅 쿼리에는
 * {@code m.session is not null}(또는 sessionId 일치)이 <b>반드시</b> 있어야 한다.
 * 빠뜨리면 아이의 수업 질문이 쪽지함에 섞이거나 그 반대가 된다.
 *
 * <p>{@code MessageResponse} 가 sender·recipient 를 읽으므로 조회 쿼리는 둘을 함께 가져온다.
 * recipient 는 없을 수 있어 {@code left join fetch} 다.
 */
public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    @Query("select m from ChatMessage m join fetch m.sender left join fetch m.recipient "
            + "where m.session.id = :sessionId order by m.createdAt asc")
    List<ChatMessage> findAllBySession(@Param("sessionId") Long sessionId);

    /**
     * 한 학생의 수업 대화 = 학생이 보낸 것 + 학생에게 보낸 것 + 학생 메시지에 달린 답장.
     *
     * <p>가운데 조건이 새로 생겼다. 예전에는 "보낸 것 + 답장" 뿐이라, 선생님이 답장 형식이
     * 아니라 그냥 보낸 메시지가 스레드에서 통째로 빠졌다. 그런 메시지는 드문 예외가 아니라
     * 흔하다 — 발행부가 {@code replyToId} 를 선택 인자로 두고 있어 안 넣고 보내는 화면이 있다.
     *
     * <p>left join 인 이유는 답장이 아닌 행을 보존하기 위해서다.
     */
    @Query("select m from ChatMessage m join fetch m.sender left join fetch m.recipient "
            + "left join m.replyTo r left join r.sender rs "
            + "where m.session.id = :sessionId "
            + "and (m.sender.id = :studentId or m.recipient.id = :studentId or rs.id = :studentId) "
            + "order by m.createdAt asc")
    List<ChatMessage> findThread(@Param("sessionId") Long sessionId, @Param("studentId") Long studentId);

    /**
     * 학생의 /me/messages — 내가 보낸 것 + 나에게 온 것 + 내 메시지에 달린 답장.
     *
     * <p><b>수업 채팅만</b>({@code m.session is not null}). 이 조건이 없어서 두 가지가 어긋나
     * 있었다. ① 내가 보낸 <b>쪽지</b>까지 딸려 나와, 쪽지 API 로 같은 메시지를 다시 받는
     * 학생 화면에서 말풍선이 두 번 그려졌다. ② 나에게 온 것을 못 봐서, 선생님이 답장 형식이
     * 아니라 그냥 보낸 메시지는 새로고침하면 사라졌다.
     */
    @Query("select m from ChatMessage m join fetch m.sender left join fetch m.recipient "
            + "left join m.replyTo r left join r.sender rs "
            + "where m.session is not null "
            + "and (m.sender.id = :userId or m.recipient.id = :userId or rs.id = :userId) "
            + "order by m.createdAt asc")
    List<ChatMessage> findAllInvolving(@Param("userId") Long userId);

    /**
     * 쪽지 대화 (양방향). 한쪽만 보이면 대화가 아니므로 보낸 것과 받은 것을 함께 본다.
     *
     * <p>{@code m.session is null} 이 계통을 가른다 — 이게 없으면 같은 두 사람의 <b>수업 채팅</b>이
     * 쪽지함에 섞인다(선생님 메시지에 수신자가 생겼으므로 recipient 조건만으로는 못 가린다).
     */
    @Query("select m from ChatMessage m join fetch m.sender left join fetch m.recipient "
            + "where m.classroom.id = :classroomId and m.session is null and m.recipient is not null "
            + "and ((m.sender.id = :userId and m.recipient.id = :peerId) "
            + "  or (m.sender.id = :peerId and m.recipient.id = :userId)) "
            + "order by m.createdAt asc")
    List<ChatMessage> findConversation(@Param("classroomId") Long classroomId,
                                       @Param("userId") Long userId,
                                       @Param("peerId") Long peerId);

    /**
     * 내가 관여한 쪽지 전부 (최근 것부터). 상대별로 접는 일은 서비스가 한다.
     *
     * <p>집계 쿼리로 한 번에 뽑지 않는 이유: 목록에는 마지막 메시지 <b>내용</b>이 필요한데,
     * group by 로는 "가장 최근 행의 content"를 같이 가져올 수 없다(윈도우 함수가 필요하다).
     * 한 사람의 쪽지 수는 학급 운영 규모라 메모리에서 접는 편이 단순하고, 접는 규칙이
     * 테스트로 덮인다는 이점도 있다.</p>
     *
     * <p>상대는 "내가 보낸 것의 수신자" 또는 "나에게 보낸 것의 발신자"다. 한쪽만 보면
     * 내가 답만 한 대화나 상대가 답 안 한 대화가 목록에서 사라진다.</p>
     *
     * <p>{@code m.session is null} 이 없으면 수업 채팅이 쪽지 목록으로 새어 든다.</p>
     */
    @Query("select m from ChatMessage m "
            + "join fetch m.sender join fetch m.recipient join fetch m.classroom "
            + "where m.session is null and m.recipient is not null "
            + "and (m.sender.id = :userId or m.recipient.id = :userId) "
            + "order by m.createdAt desc")
    List<ChatMessage> findMyDirectMessages(@Param("userId") Long userId);

    /**
     * 쪽지 스레드 읽음 처리 — <b>상대가 나에게 보낸 것만</b> 찍는다.
     * 내가 보낸 것까지 읽음으로 만들면 상대 화면의 읽음 표시가 거짓이 된다.
     * 이미 읽은 행은 건너뛴다(처음 읽은 때가 읽은 때다).
     *
     * <p>{@code m.session is null} 이 없으면 수업 채팅 행까지 읽음으로 찍힌다 — 읽음은
     * 쪽지에서만 의미가 있는 값이다.
     */
    @Modifying
    @Transactional
    @Query("update ChatMessage m set m.readAt = :readAt "
            + "where m.classroom.id = :classroomId and m.session is null "
            + "and m.sender.id = :peerId and m.recipient.id = :userId and m.readAt is null")
    int markThreadRead(@Param("classroomId") Long classroomId,
                       @Param("peerId") Long peerId,
                       @Param("userId") Long userId,
                       @Param("readAt") LocalDateTime readAt);

    /**
     * 학급 교사 단톡방 — 오래된 것부터. 세 번째 계통이다.
     *
     * <p>{@code session is null and recipient is null} 이 단톡방을 가른다. 위 쪽지 쿼리들이
     * 이미 {@code recipient is not null} 을 달고 있어 단톡방 메시지가 쪽지함에 섞이지 않는다 —
     * 그 조건을 지우면 곧바로 섞이므로 건드리지 말 것.
     *
     * <p>recipient 가 항상 없으므로 fetch 하지 않는다. {@code MessageResponse} 는 null 을 그대로 받는다.
     */
    @Query("select m from ChatMessage m join fetch m.sender "
            + "where m.classroom.id = :classroomId and m.session is null and m.recipient is null "
            + "order by m.createdAt asc")
    List<ChatMessage> findTeacherRoom(@Param("classroomId") Long classroomId);

    /**
     * 안 읽은 개수 — 마지막으로 읽은 시각 이후에 <b>남이</b> 보낸 것만 센다.
     * 내가 보낸 메시지가 내 안 읽음으로 잡히면 방을 열자마자 배지가 생긴다.
     */
    @Query("select count(m) from ChatMessage m "
            + "where m.classroom.id = :classroomId and m.session is null and m.recipient is null "
            + "and m.sender.id <> :userId "
            + "and m.createdAt > :since")
    long countTeacherRoomUnreadSince(@Param("classroomId") Long classroomId,
                                     @Param("userId") Long userId,
                                     @Param("since") LocalDateTime since);

    /**
     * 한 번도 읽지 않은 방 — 남이 보낸 것 <b>전부</b>가 안 읽음이다.
     *
     * <p>위 쿼리에 {@code (:since is null or m.createdAt > :since)} 로 <b>합치지 않는다.</b>
     * 합쳐 두었다가 운영에서 500 이 났다: PostgreSQL 은 바인딩된 null 의 타입을 추론하지
     * 못해 쿼리 자체가 실패한다. 게다가 이 방은 읽은 기록이 처음엔 아무에게도 없어서
     * <b>모든 선생님이</b> 이 경로를 탔고, 목록에서 단톡방 칸이 통째로 사라졌다.
     * 방을 열어야 읽은 기록이 생기는데 칸이 없어 열 수가 없으니 스스로 풀리지도 않았다.
     *
     * <p>테스트가 H2(기본 프로필)라 통과했다 — H2 는 이 null 을 받아 준다. 방언 차이는
     * {@code application-ci.yml}(실제 Postgres)을 쓰는 테스트에서만 걸린다.
     */
    @Query("select count(m) from ChatMessage m "
            + "where m.classroom.id = :classroomId and m.session is null and m.recipient is null "
            + "and m.sender.id <> :userId")
    long countTeacherRoomUnread(@Param("classroomId") Long classroomId,
                                @Param("userId") Long userId);

    /**
     * 목록 화면에 미리보기로 쓸 마지막 한 줄. 요약을 만들자고 방 전체를 읽으면
     * 대화가 쌓일수록 목록 화면이 느려진다 — 학급 수만큼 반복되는 조회다.
     */
    Optional<ChatMessage> findFirstByClassroomIdAndSessionIsNullAndRecipientIsNullOrderByCreatedAtDesc(
            Long classroomId);
}
