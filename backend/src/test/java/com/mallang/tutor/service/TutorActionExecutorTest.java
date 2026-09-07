package com.mallang.tutor.service;

import com.mallang.chat.dto.ChatDtos.DirectMessageRequest;
import com.mallang.chat.service.ChatRouterService;
import com.mallang.chat.service.DirectChatService;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.material.entity.Material;
import com.mallang.material.entity.MaterialStatus;
import com.mallang.material.repository.MaterialRepository;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.tutor.entity.AiTutorMessage;
import com.mallang.tutor.entity.AiTutorMessage.AnsweredBy;
import com.mallang.tutor.service.TutorActionExecutor.Delivery;
import com.mallang.tutor.service.TutorActionExecutor.Result;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 말랑이 제안 액션의 검증·실행.
 *
 * <p>여기서 지키는 것: ① LLM 이 고른 materialId 를 믿지 않는다 ② 선생님이 확인하지 않은
 * 자료를 아이에게 열어 주지 않는다 ③ 질문은 수업 중이든 아니든 반드시 전달된다
 * ④ 선생님에게 가는 글에는 <b>말랑이가 대신 전한 것</b>임을 밝힌다.</p>
 */
@ExtendWith(MockitoExtension.class)
class TutorActionExecutorTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long STUDENT_ID = 20L;
    private static final Long TEACHER_ID = 1L;
    private static final Long SESSION_ID = 900L;

    /** 실행기가 선생님에게 보낼 때 붙이는 출처 표시 — 문구가 바뀌면 이 테스트들이 먼저 깨져야 한다. */
    private static final String RELAY_PREFIX = "[말랑이가 대신 전함] ";

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock ChatRouterService chatRouterService;
    @Mock DirectChatService directChatService;
    @Mock MaterialRepository materialRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock com.mallang.user.repository.UserRepository userRepository;

    private TutorActionExecutor executor;

    @BeforeEach
    void setUp() {
        executor = new TutorActionExecutor(liveSessionRepository, chatRouterService,
                directChatService, materialRepository, memberRepository, userRepository);
    }

    /**
     * 자료 목록을 프롬프트에 실어 주던 {@code offerableMaterials} 는 사라졌다 — SHOW_MATERIAL 을
     * 더 이상 제안하지 않기 때문이다. 그래서 "선생님이 확인을 마친(READY) 자료만"이라는 관문은
     * 이제 {@code findOfferable} 하나뿐이고, 그 하나가 확실히 지키는지를 여기서 고정한다.
     */
    @Test
    void offersOnlyAMaterialTheTeacherHasConfirmed() {
        Classroom mine = classroom(CLASSROOM_ID);
        Material ready = material(1L, "확인된 자료", MaterialStatus.READY);
        when(ready.getClassroom()).thenReturn(mine);
        when(materialRepository.findById(1L)).thenReturn(Optional.of(ready));

        assertThat(executor.findOfferable(CLASSROOM_ID, 1L)).contains(ready);
        // 전체 조회로 되돌리면 미확인 자료가 아이 화면에 다시 뜬다
        verify(materialRepository, never()).findByClassroomId(CLASSROOM_ID);
    }

    @Test
    void rejectsAMaterialFromAnotherClassroom() {
        Classroom otherClassroom = classroom(999L);
        Material other = material(7L, "옆 반 자료", MaterialStatus.READY);
        when(other.getClassroom()).thenReturn(otherClassroom);
        when(materialRepository.findById(7L)).thenReturn(Optional.of(other));

        assertThat(executor.findOfferable(CLASSROOM_ID, 7L)).isEmpty();
    }

    @Test
    void rejectsAMaterialTheTeacherHasNotConfirmed() {
        Classroom mine = classroom(CLASSROOM_ID);
        Material preview = material(8L, "확인 대기", MaterialStatus.PREVIEW);
        when(preview.getClassroom()).thenReturn(mine);
        when(materialRepository.findById(8L)).thenReturn(Optional.of(preview));

        assertThat(executor.findOfferable(CLASSROOM_ID, 8L)).isEmpty();
    }

    /** 추출이 깨진 자료도 막는다 — 상태 검사가 PREVIEW 한 가지만 보고 있지 않다는 확인이다. */
    @Test
    void rejectsAMaterialWhoseTextExtractionFailed() {
        Classroom mine = classroom(CLASSROOM_ID);
        Material broken = material(11L, "추출 실패", MaterialStatus.FAILED);
        when(broken.getClassroom()).thenReturn(mine);
        when(materialRepository.findById(11L)).thenReturn(Optional.of(broken));

        assertThat(executor.findOfferable(CLASSROOM_ID, 11L)).isEmpty();
    }

    @Test
    void rejectsAnIdTheModelInvented() {
        when(materialRepository.findById(9999L)).thenReturn(Optional.empty());

        assertThat(executor.findOfferable(CLASSROOM_ID, 9999L)).isEmpty();
    }

    @Test
    void duringClassTheQuestionGoesToTheLiveChat() {
        openSessionForTheWholeClass();

        Result result = executor.execute(student(), askTeacherMessage("범위가 궁금해요"));

        assertThat(result.delivery()).isEqualTo(Delivery.SESSION_ROUTED);
        // 본문에 붙는 출처 표시는 아래 전용 테스트에서 따로 고정한다
        verify(chatRouterService).routeStudentMessage(eq(SESSION_ID), eq(STUDENT_ID), anyString());
        verify(directChatService, never()).send(any(), anyLong(), any());
    }

    @Test
    void outsideClassTheQuestionBecomesADirectMessageToTheTeacher() {
        noOpenSession();
        ownerIsTeacher();

        Result result = executor.execute(student(), askTeacherMessage("범위가 궁금해요"));

        assertThat(result.delivery()).isEqualTo(Delivery.DIRECT_MESSAGE);
        assertThat(sentDirectMessage().recipientId()).isEqualTo(TEACHER_ID);
    }

    /**
     * 수업 채팅에 뜨는 글은 아이가 직접 친 문장이 아니라 말랑이가 정리한 문장이다.
     *
     * <p>표시가 없으면 선생님은 아이가 쓴 말로 읽는다 — 말투가 어른스러워 위화감이 생기고,
     * 무엇보다 "이 아이가 이렇게 말했다"는 잘못된 사실이 선생님 기억에 남는다.</p>
     */
    @Test
    void theRoutedQuestionSaysMallangIsRelayingIt() {
        openSessionForTheWholeClass();

        executor.execute(student(), askTeacherMessage("2번 문제를 어떻게 푸는지 궁금해요"));

        ArgumentCaptor<String> captor = ArgumentCaptor.forClass(String.class);
        verify(chatRouterService).routeStudentMessage(eq(SESSION_ID), eq(STUDENT_ID), captor.capture());
        assertThat(captor.getValue())
                .startsWith(RELAY_PREFIX)
                // 표시만 앞에 붙을 뿐 정리한 질문은 한 글자도 잘리지 않는다
                .endsWith("2번 문제를 어떻게 푸는지 궁금해요");
    }

    /** 쪽지로 내려가는 경로에도 같은 표시가 붙는다 — 선생님이 보는 화면만 다를 뿐 출처는 같다. */
    @Test
    void theDirectMessageSaysMallangIsRelayingIt() {
        noOpenSession();
        ownerIsTeacher();

        executor.execute(student(), askTeacherMessage("2번 문제를 어떻게 푸는지 궁금해요"));

        assertThat(sentDirectMessage().content())
                .startsWith(RELAY_PREFIX)
                .endsWith("2번 문제를 어떻게 푸는지 궁금해요");
    }

    @Test
    void aFailedRoutingStillDeliversTheQuestion() {
        openSessionForTheWholeClass();
        // 수업이 방금 끝났거나 라우팅이 실패해도 아이의 질문이 사라지면 안 된다
        doThrow(new IllegalStateException("수업이 종료됨"))
                .when(chatRouterService).routeStudentMessage(anyLong(), anyLong(), anyString());
        ownerIsTeacher();

        Result result = executor.execute(student(), askTeacherMessage("질문"));

        assertThat(result.delivery()).isEqualTo(Delivery.DIRECT_MESSAGE);
        verify(directChatService).send(any(), anyLong(), any());
    }

    @Test
    void showMaterialIsRevalidatedAtExecutionTime() {
        // 제안할 때는 있었지만 그 사이 선생님이 지웠을 수 있다
        when(materialRepository.findById(12L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> executor.execute(student(), showMaterialMessage(12L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("지금 열 수 없어요");
    }

    /**
     * SHOW_MATERIAL 은 이제 <b>새로 제안되지 않는다</b>(AiTutorClient.parseAction 에서 뺐다).
     * 그래도 실행 경로는 살아 있어야 한다 — 배포 시점에 아직 PENDING 인 행이 최대 24시간 남아
     * 있고, 아이가 그 버튼을 누르면 자료가 열려야 한다. 이 테스트가 그 유예 기간을 지킨다.
     */
    @Test
    void anAlreadyStoredShowMaterialProposalStillOpensTheMaterial() {
        Classroom mine = classroom(CLASSROOM_ID);
        Material material = material(12L, "겹받침 연습지", MaterialStatus.READY);
        when(material.getClassroom()).thenReturn(mine);
        when(materialRepository.findById(12L)).thenReturn(Optional.of(material));
        AiTutorMessage stored = showMaterialMessage(12L);
        assertThat(stored.hasPendingAction()).isTrue();

        Result result = executor.execute(student(), stored);

        assertThat(result.materialId()).isEqualTo(12L);
        assertThat(result.materialTitle()).isEqualTo("겹받침 연습지");
        // 자료 열기는 선생님에게 아무것도 보내지 않는다
        assertThat(result.delivery()).isNull();
        verify(chatRouterService, never()).routeStudentMessage(anyLong(), anyLong(), anyString());
        verify(directChatService, never()).send(any(), anyLong(), any());
    }

    @Test
    void aClassroomWithoutATeacherCannotReceiveQuestions() {
        noOpenSession();
        when(memberRepository.findFirstByClassroomIdAndRole(CLASSROOM_ID, ClassroomRole.OWNER))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> executor.execute(student(), askTeacherMessage("질문")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("담당 선생님이 없어");
    }

    /** 학급 전체 수업(학년 없음) 하나가 열려 있는 상태. */
    private void openSessionForTheWholeClass() {
        LiveSession session = mock(LiveSession.class);
        lenient().when(session.getId()).thenReturn(SESSION_ID);
        // Mockito 는 Short 기본값으로 null 이 아니라 0 을 주므로 명시해야 한다 —
        // 안 그러면 "0학년 수업"이 되어 어느 아이와도 학년이 맞지 않는다.
        when(session.getGrade()).thenReturn(null);
        when(liveSessionRepository.findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(CLASSROOM_ID))
                .thenReturn(List.of(session));
    }

    private void noOpenSession() {
        when(liveSessionRepository.findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(CLASSROOM_ID))
                .thenReturn(List.of());
    }

    private DirectMessageRequest sentDirectMessage() {
        ArgumentCaptor<DirectMessageRequest> captor =
                ArgumentCaptor.forClass(DirectMessageRequest.class);
        verify(directChatService).send(any(), eq(CLASSROOM_ID), captor.capture());
        return captor.getValue();
    }

    private void ownerIsTeacher() {
        User teacher = mock(User.class);
        when(teacher.getId()).thenReturn(TEACHER_ID);
        ClassroomMember owner = mock(ClassroomMember.class);
        when(owner.getUser()).thenReturn(teacher);
        when(memberRepository.findFirstByClassroomIdAndRole(CLASSROOM_ID, ClassroomRole.OWNER))
                .thenReturn(Optional.of(owner));
    }

    private Material material(Long id, String title, MaterialStatus status) {
        Material material = mock(Material.class);
        lenient().when(material.getId()).thenReturn(id);
        lenient().when(material.getTitle()).thenReturn(title);
        lenient().when(material.getStatus()).thenReturn(status);
        return material;
    }

    private Classroom classroom(Long id) {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(id);
        return classroom;
    }

    private AuthUser student() {
        return new AuthUser(STUDENT_ID, Role.STUDENT, "김민수");
    }

    /** 저장된 ASK_TEACHER 행. title 은 더 이상 채워지지 않는다(null) — 실행기는 content 만 쓴다. */
    private AiTutorMessage askTeacherMessage(String content) {
        AiTutorMessage message = message();
        message.proposeAskTeacher(null, content, LocalDateTime.now().plusHours(24));
        return message;
    }

    private AiTutorMessage showMaterialMessage(Long materialId) {
        AiTutorMessage message = message();
        message.proposeShowMaterial(materialId, "자료", LocalDateTime.now().plusHours(24));
        return message;
    }

    private AiTutorMessage message() {
        return AiTutorMessage.of(classroom(CLASSROOM_ID), mock(User.class),
                "질문", "답", AnsweredBy.LLM);
    }
}
