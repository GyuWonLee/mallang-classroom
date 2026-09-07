package com.mallang.chat.service;

import com.mallang.chat.dto.ChatDtos.MessageResponse;
import com.mallang.chat.entity.ChatMessage;
import com.mallang.chat.repository.ChatMessageRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 채팅 이력 조회 권한.
 *
 * <p>학생 질문에는 사적인 내용이 섞인다. 조회 권한이 새면 같은 반 학생이 남의 상담을 읽을 수
 * 있게 되므로, "학급의 모든 선생님 + 본인"이라는 경계가 이 서비스의 전부다.</p>
 */
@ExtendWith(MockitoExtension.class)
class ChatQueryServiceTest {

    private static final Long SESSION_ID = 10L;
    private static final Long CLASSROOM_ID = 5L;
    private static final Long TEACHER_ID = 1L;
    private static final Long STUDENT_ID = 20L;

    @Mock ChatMessageRepository chatMessageRepository;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;

    private ChatQueryService service;

    @BeforeEach
    void setUp() {
        service = new ChatQueryService(
                chatMessageRepository, liveSessionRepository, classroomMemberRepository);
    }

    @Test
    void teacherReadsEveryMessageInTheSession() {
        openSession();
        role(TEACHER_ID, ClassroomRole.OWNER);
        List<ChatMessage> stored = List.of(message("질문이요"));
        when(chatMessageRepository.findAllBySession(SESSION_ID)).thenReturn(stored);

        List<MessageResponse> messages = service.sessionMessages(SESSION_ID, null, teacher());

        assertThat(messages).hasSize(1);
        assertThat(messages.get(0).content()).isEqualTo("질문이요");
    }

    @Test
    void studentIdFilterNarrowsToThatThread() {
        openSession();
        role(TEACHER_ID, ClassroomRole.OWNER);
        List<ChatMessage> stored = List.of(message("민수 질문"));
        when(chatMessageRepository.findThread(SESSION_ID, STUDENT_ID)).thenReturn(stored);

        service.sessionMessages(SESSION_ID, STUDENT_ID, teacher());

        verify(chatMessageRepository).findThread(SESSION_ID, STUDENT_ID);
        verify(chatMessageRepository, never()).findAllBySession(SESSION_ID);
    }

    @Test
    void studentCannotBrowseTheWholeSession() {
        openSession();
        role(STUDENT_ID, ClassroomRole.STUDENT);

        // 여기가 새면 같은 반 학생이 남의 상담을 읽는다
        assertThatThrownBy(() -> service.sessionMessages(SESSION_ID, null, student()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");
    }

    @Test
    void outsiderCannotBrowseTheSession() {
        openSession();
        when(classroomMemberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, 99L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.sessionMessages(SESSION_ID, null,
                new AuthUser(99L, Role.TEACHER, "남")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학급 구성원");
    }

    @Test
    void studentCanReadTheirOwnThreadWithoutBeingATeacher() {
        openSession();
        List<ChatMessage> stored = List.of(message("내 질문"));
        when(chatMessageRepository.findThread(SESSION_ID, STUDENT_ID)).thenReturn(stored);

        List<MessageResponse> thread = service.thread(SESSION_ID, STUDENT_ID, student());

        // 본인 스레드는 선생님 검증을 타지 않는다 — 자기 대화를 못 보면 화면이 성립하지 않는다
        assertThat(thread).hasSize(1);
        verify(classroomMemberRepository, never())
                .findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID);
    }

    @Test
    void studentCannotReadAnotherStudentsThread() {
        openSession();
        role(99L, ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service.thread(SESSION_ID, STUDENT_ID,
                new AuthUser(99L, Role.STUDENT, "남의학생")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");
    }

    @Test
    void historyOfAnEndedSessionIsStillReadable() {
        // 기록은 영구다 — 수업이 끝났다고 지난 상담을 못 보면 안 된다
        LiveSession ended = sessionEntity();
        lenient().when(ended.getEndedAt()).thenReturn(java.time.LocalDateTime.now());
        when(liveSessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(ended));
        role(TEACHER_ID, ClassroomRole.OWNER);
        when(chatMessageRepository.findAllBySession(SESSION_ID)).thenReturn(List.of());

        assertThat(service.sessionMessages(SESSION_ID, null, teacher())).isEmpty();
    }

    @Test
    void unknownSessionIs404() {
        when(liveSessionRepository.findById(SESSION_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.sessionMessages(SESSION_ID, null, teacher()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("존재하지 않는 수업");
    }

    @Test
    void myMessagesIsForStudentsOnly() {
        // 선생님에게는 "내가 보낸 것"이 대화 단위로 성립하지 않는다 — 수업별 목록을 쓴다
        assertThatThrownBy(() -> service.myMessages(teacher()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학생 전용");
    }

    @Test
    void studentSeesTheirOwnMessagesAcrossSessions() {
        List<ChatMessage> stored = List.of(message("어제 질문"));
        when(chatMessageRepository.findAllInvolving(STUDENT_ID)).thenReturn(stored);

        assertThat(service.myMessages(student())).hasSize(1);
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void openSession() {
        Optional<LiveSession> found = Optional.of(sessionEntity());
        lenient().when(liveSessionRepository.findById(SESSION_ID)).thenReturn(found);
    }

    /** 이 수업을 연 사람은 TEACHER_ID — 대화를 볼 수 있는 건 그 사람뿐이다 */
    /**
     * 수업을 하지 않는 동료 선생님은 그 수업의 대화를 볼 수 없다.
     *
     * <p>예전에는 학급 관리자면 누구나 볼 수 있어서, 옆 학년 수업을 하는 선생님의 채팅 화면에도
     * 아이들 질문이 쌓였다. 실시간 배달은 배정된 선생님 한 명에게만 가므로 그쪽은 새로 고쳐야
     * 보이는 어중간한 상태이기도 했다 — 수업에 들어가는 것 자체가 시작한 사람만 되는데
     * 대화만 열려 있던 셈이다.</p>
     */
    @Test
    void anotherTeacherCannotReadSomeoneElsesSessionChat() {
        Long otherTeacher = 99L;
        LiveSession session = sessionStartedBy(TEACHER_ID);
        when(liveSessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(session));
        role(otherTeacher, ClassroomRole.MAINTAINER);

        assertThatThrownBy(() -> service.sessionMessages(
                SESSION_ID, null, new AuthUser(otherTeacher, Role.TEACHER, "남선생")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("진행하는 선생님");
    }

    private LiveSession sessionEntity() {
        return sessionStartedBy(TEACHER_ID);
    }

    private LiveSession sessionStartedBy(Long starterId) {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(CLASSROOM_ID);
        User starter = mock(User.class);
        lenient().when(starter.getId()).thenReturn(starterId);
        LiveSession session = mock(LiveSession.class);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        lenient().when(session.getStartedBy()).thenReturn(starter);
        return session;
    }

    private void role(Long userId, ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        Optional<ClassroomMember> found = Optional.of(member);
        lenient().when(classroomMemberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, userId))
                .thenReturn(found);
    }

    private ChatMessage message(String content) {
        Classroom classroom = mock(Classroom.class);
        User sender = mock(User.class);
        lenient().when(sender.getId()).thenReturn(STUDENT_ID);
        lenient().when(sender.getName()).thenReturn("김민수");
        LiveSession session = mock(LiveSession.class);
        lenient().when(session.getId()).thenReturn(SESSION_ID);
        lenient().when(session.getClassroom()).thenReturn(classroom);
        return ChatMessage.of(session, sender, content, null);
    }

    private AuthUser teacher() {
        return new AuthUser(TEACHER_ID, Role.TEACHER, "김선생");
    }

    private AuthUser student() {
        return new AuthUser(STUDENT_ID, Role.STUDENT, "김민수");
    }
}
