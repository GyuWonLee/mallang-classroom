package com.mallang.chat.service;

import com.mallang.chat.entity.ChatMessage;
import com.mallang.chat.repository.ChatMessageRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.service.PresenceService;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 채팅 라우팅·대기열 — S15P11A407-133
 *
 * 명세 §6 의 라우팅 규칙(배정 확인 → 같은 팀 선생님 → 한가한 선생님 → 대기열)과
 * 대기열 수명주기를 고정한다. 이 도메인은 Redis 키 5종이 얽혀 있어 눈으로 읽어서는
 * 회귀를 못 잡는다.
 */
@ExtendWith(MockitoExtension.class)
class ChatRouterServiceTest {

    private static final Long SESSION = 10L;
    private static final Long STUDENT = 11L;
    private static final Long TEACHER = 1L;
    private static final Long CLASSROOM = 5L;
    private static final String PERSONAL = "/sub/notifications";

    @Mock PresenceService presenceService;
    @Mock StringRedisTemplate redis;
    @Mock ValueOperations<String, String> valueOps;
    @Mock SetOperations<String, String> setOps;
    @Mock ListOperations<String, String> listOps;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock ChatMessageRepository chatMessageRepository;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock UserRepository userRepository;
    @Mock ClassroomMemberRepository memberRepository;

    private ChatRouterService service;

    @BeforeEach
    void setUp() {
        service = new ChatRouterService(presenceService, redis, messagingTemplate,
                chatMessageRepository, liveSessionRepository, userRepository, memberRepository);
        lenient().when(redis.opsForValue()).thenReturn(valueOps);
        lenient().when(redis.opsForSet()).thenReturn(setOps);
        lenient().when(redis.opsForList()).thenReturn(listOps);
    }

    // ── 라우팅 규칙 ───────────────────────────────────────────────────────────

    @Test
    void alreadyAssignedStudentGoesToThatTeacherRegardlessOfPresence() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn("1");

        service.routeStudentMessage(SESSION, STUDENT, "선생님 이거 모르겠어요");

        assertThat(payloadSentTo(TEACHER)).containsEntry("content", "선생님 이거 모르겠어요");
        // 배정이 있으면 프레즌스를 다시 뒤지지 않는다 — sticky 의 핵심
        verify(presenceService, never()).teacherInStudentTeam(any(), any());
        verify(presenceService, never()).anyFreeTeacher(any());
    }

    @Test
    void fallsBackToFreeTeacherWhenNobodyIsInTheStudentsTeam() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn(null);
        when(presenceService.teacherInStudentTeam(SESSION, STUDENT)).thenReturn(Optional.empty());
        when(presenceService.anyFreeTeacher(any())).thenReturn(Optional.of(TEACHER));

        service.routeStudentMessage(SESSION, STUDENT, "질문 있어요");

        // 배정이 양방향으로 기록돼야 이후 답장 검증이 통과한다
        verify(valueOps).set("chat:assign:student:11", "1");
        verify(setOps).add("chat:assign:teacher:1", "11");
        assertThat(payloadSentTo(TEACHER)).containsEntry("content", "질문 있어요");
    }

    @Test
    void queuesStudentWhenNoTeacherIsAvailable() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn(null);
        when(presenceService.teacherInStudentTeam(SESSION, STUDENT)).thenReturn(Optional.empty());
        when(presenceService.anyFreeTeacher(any())).thenReturn(Optional.empty());
        when(setOps.add("chat:waiting:members", "11")).thenReturn(1L);

        service.routeStudentMessage(SESSION, STUDENT, "질문 있어요");

        verify(listOps).leftPush("chat:waiting", "11");
        // 메시지는 버리지 않고 쌓아둔다 — 배정 순간 한꺼번에 전달된다
        verify(listOps).leftPush("chat:pending:11", "10:질문 있어요");
    }

    @Test
    void askingTwiceWhileWaitingDoesNotTakeTwoQueueSlots() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn(null);
        when(presenceService.teacherInStudentTeam(SESSION, STUDENT)).thenReturn(Optional.empty());
        when(presenceService.anyFreeTeacher(any())).thenReturn(Optional.empty());
        // SADD 가 0 = 이미 줄 서 있음
        when(setOps.add("chat:waiting:members", "11")).thenReturn(0L);

        service.routeStudentMessage(SESSION, STUDENT, "아직인가요?");

        verify(listOps, never()).leftPush(eq("chat:waiting"), any());
        // 번호표는 그대로여도 질문은 쌓인다
        verify(listOps).leftPush("chat:pending:11", "10:아직인가요?");
    }

    @Test
    void messageIsSavedEvenWhenItGoesToTheQueue() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn(null);
        when(presenceService.teacherInStudentTeam(SESSION, STUDENT)).thenReturn(Optional.empty());
        when(presenceService.anyFreeTeacher(any())).thenReturn(Optional.empty());
        when(setOps.add("chat:waiting:members", "11")).thenReturn(1L);

        service.routeStudentMessage(SESSION, STUDENT, "질문 있어요");

        // 라우팅이 어디로 가든 DB 저장은 항상 — 선생님이 목록에서 뒤늦게라도 볼 수 있어야 한다
        verify(chatMessageRepository).save(any(ChatMessage.class));
    }

    @Test
    void messageToEndedSessionIsRejected() {
        when(liveSessionRepository.findByIdAndEndedAtIsNull(SESSION)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.routeStudentMessage(SESSION, STUDENT, "질문"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("진행 중인 수업이 아니");

        verify(chatMessageRepository, never()).save(any());
    }

    // ── 대기열 해소 ───────────────────────────────────────────────────────────

    @Test
    void freeTeacherTakesTheWholeQueue() {
        // 팀 결정: 한 명씩 나눠 갖지 않고 통째로 가져간다 (배정이 1:N 구조)
        myLiveStudents(11L, 12L);
        when(listOps.rightPop("chat:waiting")).thenReturn("11", "12", null);
        when(listOps.rightPop("chat:pending:11")).thenReturn(null);
        when(listOps.rightPop("chat:pending:12")).thenReturn(null);

        service.drainWaitingQueue(TEACHER);

        verify(valueOps).set("chat:assign:student:11", "1");
        verify(valueOps).set("chat:assign:student:12", "1");
        verify(setOps).remove("chat:waiting:members", "11");
        verify(setOps).remove("chat:waiting:members", "12");
    }

    @Test
    void pendingMessagesAreDeliveredInOrderOnAssignment() {
        myLiveStudents(11L);
        when(listOps.rightPop("chat:waiting")).thenReturn("11", null);
        // leftPush 로 쌓았으므로 rightPop 이 오래된 순서
        when(listOps.rightPop("chat:pending:11"))
                .thenReturn("10:먼저 한 질문", "10:나중 질문", null);

        service.drainWaitingQueue(TEACHER);

        ArgumentCaptor<StompEnvelope> sent = ArgumentCaptor.forClass(StompEnvelope.class);
        verify(messagingTemplate, atLeastOnce())
                .convertAndSendToUser(eq("1"), eq(PERSONAL), sent.capture());
        List<String> contents = sent.getAllValues().stream()
                .map(envelope -> (Map<?, ?>) envelope.payload())
                .map(payload -> String.valueOf(payload.get("content")))
                .filter(content -> content.contains("질문"))
                .toList();
        assertThat(contents).containsExactly("먼저 한 질문", "나중 질문");
    }

    /**
     * 신고된 증상 그대로다 — 한 학급에서 1학년 수업과 3학년 수업이 나란히 돌 때,
     * 3학년 수업 선생님이 1학년 아이를 데려가면 안 된다. 같은 학급이라 예전 기준
     * (shareClassroom)으로는 통과했다.
     */
    @Test
    void aTeacherDoesNotTakeStudentsOfAnotherGradesClass() {
        LiveSession mine = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(CLASSROOM);
        lenient().when(mine.getClassroom()).thenReturn(classroom);
        lenient().when(mine.getGrade()).thenReturn((short) 3);          // 나는 3학년 수업 중
        when(liveSessionRepository.findAllByStartedByIdAndEndedAtIsNull(TEACHER))
                .thenReturn(List.of(mine));
        // 아이는 같은 학급이지만 1학년이다
        lenient().when(memberRepository.findByClassroomIdAndUserId(CLASSROOM, 11L))
                .thenReturn(Optional.of(mock(ClassroomMember.class)));
        User firstGrader = mock(User.class);
        lenient().when(firstGrader.getGrade()).thenReturn((short) 1);
        lenient().when(userRepository.findById(11L)).thenReturn(Optional.of(firstGrader));
        when(listOps.rightPop("chat:waiting")).thenReturn("11", null);

        service.drainWaitingQueue(TEACHER);

        verify(valueOps, never()).set(eq("chat:assign:student:11"), any());
        // 번호표는 그대로 — 1학년 수업 선생님이 오면 그때 데려간다
        verify(setOps, never()).remove("chat:waiting:members", "11");
        verify(listOps).rightPushAll("chat:waiting", List.of("11"));
    }

    @Test
    void emptyQueueAssignsNobody() {
        when(listOps.rightPop("chat:waiting")).thenReturn(null);

        service.drainWaitingQueue(TEACHER);

        verify(valueOps, never()).set(eq("chat:assign:student:11"), any());
    }

    // ── 답장 권한 ─────────────────────────────────────────────────────────────

    /**
     * 배정만으로는 부족하다 — 배정은 Redis 에 남는 휘발 상태라, 학급에서 제외된 선생님이나
     * 옛 배정이 남은 선생님이 계속 답장할 수 있다. 아이가 쓴 글이 오갈 상대는 그 반 선생님뿐이다.
     */
    @Test
    void teacherFromAnotherClassroomCannotReplyEvenWhenAssigned() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn("1");
        when(memberRepository.shareClassroom(TEACHER, STUDENT)).thenReturn(false);

        assertThatThrownBy(() -> service.routeTeacherReply(SESSION, TEACHER, STUDENT, "답변", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("같은 학급이 아닙니다");

        verify(chatMessageRepository, never()).save(any());
    }

    /** 내 수업 학생이 아니면 대기열에 그대로 남는다 — 그 수업 선생님이 오면 그때 가져간다 */
    @Test
    void studentsFromOtherClassroomsStayInTheQueue() {
        when(listOps.rightPop("chat:waiting")).thenReturn("11", "12", null);
        // 12번만 내 수업 학생이다. 11번은 조회가 비어 있어 그대로 걸러진다
        myLiveStudents(12L);
        when(listOps.rightPop("chat:pending:12")).thenReturn(null);

        service.drainWaitingQueue(TEACHER);

        verify(valueOps).set("chat:assign:student:12", "1");
        verify(valueOps, never()).set(eq("chat:assign:student:11"), any());
        // 번호표도 반납하지 않는다 — 여전히 줄 서 있는 상태여야 한다
        verify(setOps, never()).remove("chat:waiting:members", "11");
        verify(listOps).rightPushAll("chat:waiting", List.of("11"));
    }

    /**
     * 교사 메시지에 수신자를 적는다. 안 적으면 그 메시지는 DB 에서 어떤 학생과도 이어지지
     * 않아, 답장 형식이 아닌 경우 학생 이력에서도 교사 스레드에서도 사라진다.
     */
    @Test
    void aTeacherMessageRecordsWhoItWasFor() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn("1");
        when(memberRepository.shareClassroom(TEACHER, STUDENT)).thenReturn(true);
        User teacherRef = mock(User.class);
        User studentRef = mock(User.class);
        when(userRepository.getReferenceById(TEACHER)).thenReturn(teacherRef);
        when(userRepository.getReferenceById(STUDENT)).thenReturn(studentRef);

        service.routeTeacherReply(SESSION, TEACHER, STUDENT, "이렇게 해 보자", null);

        ArgumentCaptor<ChatMessage> saved = ArgumentCaptor.forClass(ChatMessage.class);
        verify(chatMessageRepository).save(saved.capture());
        assertThat(saved.getValue().getRecipient()).isSameAs(studentRef);
        assertThat(saved.getValue().getSender()).isSameAs(teacherRef);
    }

    /** 학생 메시지는 받을 사람이 아직 없다 — 대기열이 나중에 정한다 */
    @Test
    void aStudentMessageHasNoRecipientYet() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn("1");

        service.routeStudentMessage(SESSION, STUDENT, "질문 있어요");

        ArgumentCaptor<ChatMessage> saved = ArgumentCaptor.forClass(ChatMessage.class);
        verify(chatMessageRepository).save(saved.capture());
        assertThat(saved.getValue().getRecipient()).isNull();
    }

    @Test
    void teacherCannotReplyToAStudentAssignedToSomeoneElse() {
        openSession();
        when(valueOps.get("chat:assign:student:11")).thenReturn("2"); // 다른 선생님

        assertThatThrownBy(() -> service.routeTeacherReply(SESSION, TEACHER, STUDENT, "답변", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("배정된 대화가 없습니다");

        verify(chatMessageRepository, never()).save(any());
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    /**
     * 내가 지금 진행 중인 수업의 학생들 — 대기열에서 데려갈 수 있는 조건이다.
     *
     * <p>예전 기준은 {@code shareClassroom}("학급을 하나라도 같이 쓰는가")이었다. 학년별로
     * 수업이 갈린 뒤로는(V31) 그것만 보면 수업에 들어가지도 않은 동료가 남의 수업 학생을
     * 데려간다. 여기서는 학급 전체 수업(grade = null)을 하나 열어 둔 상태를 만든다.</p>
     */
    private void myLiveStudents(Long... studentIds) {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(CLASSROOM);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        // Mockito 는 Short 기본값으로 0 을 주므로 명시한다 — 0 이면 "0학년 수업"이 된다
        lenient().when(session.getGrade()).thenReturn(null);
        when(liveSessionRepository.findAllByStartedByIdAndEndedAtIsNull(TEACHER))
                .thenReturn(List.of(session));
        for (Long id : studentIds) {
            lenient().when(memberRepository.findByClassroomIdAndUserId(CLASSROOM, id))
                    .thenReturn(Optional.of(mock(ClassroomMember.class)));
        }
    }

    private void sameClassroom(Long... studentIds) {
        for (Long id : studentIds) {
            when(memberRepository.shareClassroom(TEACHER, id)).thenReturn(true);
        }
    }

    private void openSession() {
        LiveSession session = mock(LiveSession.class);
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(CLASSROOM);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        when(liveSessionRepository.findByIdAndEndedAtIsNull(SESSION))
                .thenReturn(Optional.of(session));
    }

    /** 와일드카드(Map<?,?>)로 두면 containsEntry 가 타입 추론에 걸린다 — 명시 캐스트가 필요하다. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> payloadSentTo(Long userId) {
        ArgumentCaptor<StompEnvelope> sent = ArgumentCaptor.forClass(StompEnvelope.class);
        verify(messagingTemplate, atLeastOnce())
                .convertAndSendToUser(eq(String.valueOf(userId)), eq(PERSONAL), sent.capture());
        List<StompEnvelope> all = sent.getAllValues();
        return (Map<String, Object>) all.get(all.size() - 1).payload();
    }
}
