package com.mallang.chat.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.chat.dto.ChatDtos.TeacherRoomSummary;
import com.mallang.chat.entity.TeacherRoomRead;
import com.mallang.chat.repository.ChatMessageRepository;
import com.mallang.chat.repository.TeacherRoomReadRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 학급 교사 단톡방 요약 — 안 읽은 개수를 세는 두 갈래.
 *
 * <p>여기 있는 첫 두 테스트는 <b>운영 장애에서 나왔다.</b> 요약 쿼리 하나에
 * {@code (:since is null or m.createdAt > :since)} 로 두 경우를 합쳐 놨더니, 읽은 기록이
 * 없는 사람(=기능이 막 나왔을 때의 전원)에게 PostgreSQL 이 500 을 냈다. 프론트는 요약 실패를
 * 삼키고 칸만 지우므로, 증상은 "선생님을 초대했는데 단톡방이 안 생긴다" 였다.</p>
 *
 * <p>⚠ 이 테스트는 <b>어느 저장소 메서드를 부르는지</b>만 본다. 기본 테스트 프로필이 H2 라
 * 방언 차이(null 파라미터 타입 추론)는 여기서 재현되지 않는다 — 실제 Postgres 로 도는 것은
 * {@code application-ci.yml} 을 쓰는 쪽뿐이다. 그래서 "합치지 않았다"를 고정하는 것이
 * 이 테스트가 할 수 있는 최선의 방어다.</p>
 */
@ExtendWith(MockitoExtension.class)
class TeacherRoomServiceTest {

    private static final Long CLASSROOM_ID = 66L;
    private static final Long ME = 1L;

    @Mock AssignmentAccessGuard accessGuard;
    @Mock ChatMessageRepository chatMessageRepository;
    @Mock TeacherRoomReadRepository readRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock UserRepository userRepository;
    @Mock SimpMessagingTemplate messagingTemplate;

    private TeacherRoomService service;

    @BeforeEach
    void setUp() {
        service = new TeacherRoomService(accessGuard, chatMessageRepository, readRepository,
                memberRepository, userRepository, messagingTemplate);
    }

    @Test
    void neverReadRoomCountsEveryoneElsesMessages() {
        manager();
        // 읽은 기록이 없다 — 방이 막 생겼을 때 모든 선생님이 이 상태다
        when(readRepository.findByClassroomIdAndUserId(CLASSROOM_ID, ME))
                .thenReturn(Optional.empty());
        when(chatMessageRepository.countTeacherRoomUnread(CLASSROOM_ID, ME)).thenReturn(3L);
        noLastMessage();

        TeacherRoomSummary summary = service.summary(viewer(), CLASSROOM_ID);

        assertThat(summary.unreadCount()).isEqualTo(3L);
        // "그 시각 이후"를 묻는 쿼리에 null 을 넘기지 않는다 — 그게 운영에서 터진 경로다
        verify(chatMessageRepository, never()).countTeacherRoomUnreadSince(anyLong(), anyLong(), any());
    }

    @Test
    void readRoomCountsOnlyWhatArrivedAfterTheLastRead() {
        manager();
        LocalDateTime lastRead = LocalDateTime.of(2026, 8, 5, 14, 11);
        TeacherRoomRead read = mock(TeacherRoomRead.class);
        when(read.getLastReadAt()).thenReturn(lastRead);
        when(readRepository.findByClassroomIdAndUserId(CLASSROOM_ID, ME))
                .thenReturn(Optional.of(read));
        when(chatMessageRepository.countTeacherRoomUnreadSince(CLASSROOM_ID, ME, lastRead))
                .thenReturn(2L);
        noLastMessage();

        TeacherRoomSummary summary = service.summary(viewer(), CLASSROOM_ID);

        assertThat(summary.unreadCount()).isEqualTo(2L);
        verify(chatMessageRepository, never()).countTeacherRoomUnread(anyLong(), anyLong());
    }

    @Test
    void emptyRoomStillHasASummary() {
        manager();
        when(readRepository.findByClassroomIdAndUserId(CLASSROOM_ID, ME))
                .thenReturn(Optional.empty());
        when(chatMessageRepository.countTeacherRoomUnread(CLASSROOM_ID, ME)).thenReturn(0L);
        noLastMessage();

        TeacherRoomSummary summary = service.summary(viewer(), CLASSROOM_ID);

        // 아무도 말하지 않아도 요약은 나와야 한다 — 목록이 이걸로 칸을 만든다.
        // null 이나 예외를 주면 "방이 없는" 것과 구분되지 않는다.
        assertThat(summary.classroomId()).isEqualTo(CLASSROOM_ID);
        assertThat(summary.lastMessage()).isNull();
        assertThat(summary.unreadCount()).isZero();
    }

    @Test
    void senderDoesNotGetTheirOwnMessagePushedBack() {
        Classroom classroom = mock(Classroom.class);
        when(accessGuard.requireManager(CLASSROOM_ID, ME)).thenReturn(classroom);
        when(userRepository.getReferenceById(any())).thenReturn(mock(User.class));
        when(chatMessageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(memberRepository.findUserIdsByClassroomIdAndRoleIn(eq(CLASSROOM_ID), any()))
                .thenReturn(List.of(ME, 2L, 3L));

        service.send(viewer(), CLASSROOM_ID,
                new com.mallang.chat.dto.ChatDtos.TeacherRoomRequest("내일 회의 10시로 옮길게요"));

        // 보낸 사람에게 되돌려 주면 201 응답과 겹쳐 화면에 같은 말이 두 번 그려진다
        verify(messagingTemplate, never())
                .convertAndSendToUser(eq(String.valueOf(ME)), any(), any(Object.class));
        verify(messagingTemplate).convertAndSendToUser(eq("2"), any(), any(Object.class));
        verify(messagingTemplate).convertAndSendToUser(eq("3"), any(), any(Object.class));
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void manager() {
        when(accessGuard.requireManager(CLASSROOM_ID, ME)).thenReturn(mock(Classroom.class));
    }

    /** 아직 아무도 말하지 않은 방 — 미리보기가 없다. */
    private void noLastMessage() {
        when(chatMessageRepository
                .findFirstByClassroomIdAndSessionIsNullAndRecipientIsNullOrderByCreatedAtDesc(
                        CLASSROOM_ID))
                .thenReturn(Optional.empty());
    }

    private AuthUser viewer() {
        return new AuthUser(ME, Role.TEACHER, "김선생");
    }
}
