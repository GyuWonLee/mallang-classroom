package com.mallang.session.service;

import com.mallang.chat.service.ChatRouterService;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.SessionStartNotifier;
import com.mallang.session.dto.SessionDtos.SessionDetailResponse;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionHistoryView;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.session.repository.SessionParticipantRepository.HeadcountView;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 수업 이력 목록·상세 — S15P11A407-127
 *
 * state 와 갈리는 지점이 핵심이다: state 는 진행 중 수업만 열지만
 * 이력/상세는 끝난 수업이 주 대상이다.
 */
@ExtendWith(MockitoExtension.class)
class SessionHistoryTest {

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock SessionParticipantRepository sessionParticipantRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock UserRepository userRepository;
    @Mock ChatRouterService chatRouterService;
    @Mock SessionStartNotifier sessionStartNotifier;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock StringRedisTemplate redis;
    @Mock ObjectMapper objectMapper;
    @Mock LiveKitRoomService liveKitRoomService;
    @Mock SessionTopicService sessionTopicService;

    private SessionService service;

    @BeforeEach
    void setUp() {
        service = new SessionService(liveSessionRepository, sessionParticipantRepository,
                classroomMemberRepository, teamMemberRepository, userRepository, chatRouterService,
                sessionStartNotifier, messagingTemplate, redis, objectMapper, liveKitRoomService,
                sessionTopicService);
    }

    @Test
    void listsSessionsNewestFirstWithHeadcount() {
        memberOf(2L, 1L);
        SessionHistoryView live = session(10L, LocalDateTime.of(2026, 7, 30, 9, 0), null);
        SessionHistoryView ended = session(9L, LocalDateTime.of(2026, 7, 29, 9, 0),
                LocalDateTime.of(2026, 7, 29, 9, 40));
        // 픽스처를 먼저 만든다 — thenReturn 안에서 스텁하면 UnfinishedStubbingException
        List<HeadcountView> counts = List.of(headcount(10L, 21), headcount(9L, 24));
        when(liveSessionRepository.findHistoryByClassroomId(2L)).thenReturn(List.of(live, ended));
        when(sessionParticipantRepository.countDistinctUsersBySessionIds(List.of(10L, 9L)))
                .thenReturn(counts);

        List<SessionDetailResponse> history = service.history(2L, authUser(1L));

        assertThat(history).extracting(SessionDetailResponse::sessionId).containsExactly(10L, 9L);
        // 진행 중인 수업도 이력 맨 앞에 포함된다 — "오늘 수업"이 목록에서 사라지면 안 된다
        assertThat(history.get(0).live()).isTrue();
        assertThat(history.get(0).participantCount()).isEqualTo(21);
        assertThat(history.get(1).live()).isFalse();
        assertThat(history.get(1).endedAt()).isEqualTo(LocalDateTime.of(2026, 7, 29, 9, 40));
        assertThat(history.get(1).participantCount()).isEqualTo(24);
    }

    @Test
    void sessionNobodyJoinedCountsZeroInsteadOfFailing() {
        memberOf(2L, 1L);
        SessionHistoryView ghost = session(9L, LocalDateTime.of(2026, 7, 29, 9, 0),
                LocalDateTime.of(2026, 7, 29, 9, 1));
        when(liveSessionRepository.findHistoryByClassroomId(2L)).thenReturn(List.of(ghost));
        // 아무도 안 들어온 수업은 group by 결과에 아예 행이 없다
        when(sessionParticipantRepository.countDistinctUsersBySessionIds(List.of(9L)))
                .thenReturn(List.of());

        assertThat(service.history(2L, authUser(1L)).get(0).participantCount()).isZero();
    }

    @Test
    void emptyHistorySkipsTheHeadcountQuery() {
        memberOf(2L, 1L);
        when(liveSessionRepository.findHistoryByClassroomId(2L)).thenReturn(List.of());

        assertThat(service.history(2L, authUser(1L))).isEmpty();
        // in () 빈 목록으로 쿼리를 던지지 않는다
        verify(sessionParticipantRepository, never()).countDistinctUsersBySessionIds(anyCollection());
    }

    @Test
    void historyRejectsNonMember() {
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 99L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.history(2L, authUser(99L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원");
    }

    @Test
    void detailOpensEndedSession() {
        memberOf(2L, 1L);
        LiveSession ended = sessionEntity(9L, LocalDateTime.of(2026, 7, 29, 9, 0),
                LocalDateTime.of(2026, 7, 29, 9, 40));
        List<HeadcountView> counts = List.of(headcount(9L, 24));
        when(liveSessionRepository.findWithStartedByById(9L)).thenReturn(Optional.of(ended));
        when(sessionParticipantRepository.countDistinctUsersBySessionIds(List.of(9L)))
                .thenReturn(counts);

        SessionDetailResponse detail = service.detail(9L, authUser(1L));

        // state 는 종료된 수업에 404 를 내지만 상세는 열려야 한다 (지난 수업 화면)
        assertThat(detail.live()).isFalse();
        assertThat(detail.startedByName()).isEqualTo("이선생");
        assertThat(detail.participantCount()).isEqualTo(24);
    }

    @Test
    void detailRejectsNonMember() {
        LiveSession ended = sessionEntity(9L, LocalDateTime.of(2026, 7, 29, 9, 0),
                LocalDateTime.of(2026, 7, 29, 9, 40));
        when(liveSessionRepository.findWithStartedByById(9L)).thenReturn(Optional.of(ended));
        when(classroomMemberRepository.findByClassroomIdAndUserId(2L, 99L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.detail(9L, authUser(99L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원");
    }

    @Test
    void unknownSessionIs404() {
        when(liveSessionRepository.findWithStartedByById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.detail(99L, authUser(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("수업을 찾을 수 없습니다");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser authUser(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private void memberOf(Long classroomId, Long userId) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(ClassroomRole.OWNER);
        lenient().when(classroomMemberRepository.findByClassroomIdAndUserId(classroomId, userId))
                .thenReturn(Optional.of(member));
    }

    // 이력 <b>목록</b>은 엔티티가 아니라 투영으로 읽는다(칠판 스냅샷 jsonb 를 안 끌고 오려고).
    // 레코드라 목이 필요 없다 — 픽스처가 그만큼 짧아졌다.
    private SessionHistoryView session(Long id, LocalDateTime startedAt, LocalDateTime endedAt) {
        return new SessionHistoryView(id, 2L, "이선생", startedAt, endedAt);
    }

    // 상세는 한 건만 열므로 여전히 엔티티다 — 그 화면에선 칠판 스냅샷도 쓸 수 있어야 한다.
    private LiveSession sessionEntity(Long id, LocalDateTime startedAt, LocalDateTime endedAt) {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        User startedBy = mock(User.class);
        lenient().when(classroom.getId()).thenReturn(2L);
        lenient().when(startedBy.getName()).thenReturn("이선생");
        lenient().when(session.getId()).thenReturn(id);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        lenient().when(session.getStartedBy()).thenReturn(startedBy);
        lenient().when(session.getStartedAt()).thenReturn(startedAt);
        lenient().when(session.getEndedAt()).thenReturn(endedAt);
        return session;
    }

    private HeadcountView headcount(Long sessionId, long count) {
        HeadcountView view = mock(HeadcountView.class);
        lenient().when(view.getSessionId()).thenReturn(sessionId);
        lenient().when(view.getHeadcount()).thenReturn(count);
        return view;
    }
}
