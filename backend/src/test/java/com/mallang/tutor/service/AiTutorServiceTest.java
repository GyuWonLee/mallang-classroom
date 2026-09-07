package com.mallang.tutor.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.tutor.dto.TutorDtos.AskRequest;
import com.mallang.tutor.dto.TutorDtos.ActionDecisionRequest;
import com.mallang.tutor.dto.TutorDtos.ActionDecisionRequest.Decision;
import com.mallang.tutor.dto.TutorDtos.ActionResultResponse;
import com.mallang.tutor.dto.TutorDtos.AnswerResponse;
import com.mallang.tutor.dto.TutorDtos.TutorMessageResponse;
import com.mallang.tutor.entity.AiTutorMemory;
import com.mallang.tutor.entity.AiTutorMessage;
import com.mallang.tutor.entity.AiTutorMessage.AnsweredBy;
import com.mallang.tutor.repository.AiTutorMemoryRepository;
import com.mallang.tutor.entity.TutorActionStatus;
import com.mallang.tutor.entity.TutorActionType;
import com.mallang.tutor.repository.AiTutorMessageRepository;
import com.mallang.tutor.service.AiTutorClient.Turn;
import com.mallang.tutor.service.TutorActionExecutor.Delivery;
import com.mallang.tutor.service.TutorActionExecutor.Result;
import com.mallang.tutor.service.TutorReply.ProposedAction;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI 말랑이 (학생 튜터) — S15P11A407-137
 *
 * <p>명세에 올라온 적조차 없던 기능이라(§11.1 #1) 정책을 함께 정하고 구현했다.
 * 여기 테스트가 그 정책을 고정한다:</p>
 *
 * <ul>
 *   <li>학생 전용 — 선생님 도구가 아니다</li>
 *   <li>학생당 하루 호출 상한 — 크레딧이 무제한이 아니다. 다만 답을 못 만든 날은 돌려준다</li>
 *   <li>LLM 이 없거나 실패하면 안내 문구로 대체 — 저학년 화면이 빈 채로 멈추면 안 된다</li>
 *   <li>질문·답을 기록 — 안전 확인과 비용 추적의 근거</li>
 *   <li>문맥은 요약(오래된 것) + 최근 대화 세 턱(방금 것) — 폴백·차단은 대화가 아니라 빠진다</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class AiTutorServiceTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long STUDENT_ID = 20L;
    private static final Long MESSAGE_ID = 77L;

    @Mock AssignmentAccessGuard accessGuard;
    @Mock AiTutorClient tutorClient;
    @Mock AiTutorQuota quota;
    @Mock TutorSafetyFilter safetyFilter;
    @Mock AiTutorMessageRepository messageRepository;
    @Mock AiTutorMemoryRepository memoryRepository;
    @Mock TutorMaterialGrounding grounding;
    @Mock UserRepository userRepository;
    @Mock TutorActionExecutor actionExecutor;
    @Mock TutorMemoryUpdater memoryUpdater;

    /** ask 에 실려 나간 최근 대화 턱 — 순서와 내용이 이 테스트들의 관심사다. */
    @Captor ArgumentCaptor<List<Turn>> turnsCaptor;

    private AiTutorService service;

    @BeforeEach
    void setUp() {
        service = new AiTutorService(accessGuard, tutorClient, quota, safetyFilter,
                messageRepository, memoryRepository, grounding, userRepository, actionExecutor,
                memoryUpdater);
    }

    @Test
    void answersAStudentQuestionAndRecordsIt() {
        member();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(TutorReply.of("받침은 글자 아래에 붙는 자음이에요!"));
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        when(messageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "받침이 뭐예요?"));

        assertThat(response.answer()).isEqualTo("받침은 글자 아래에 붙는 자음이에요!");
        assertThat(response.answeredBy()).isEqualTo(AnsweredBy.LLM);

        ArgumentCaptor<AiTutorMessage> captor = ArgumentCaptor.forClass(AiTutorMessage.class);
        verify(messageRepository).save(captor.capture());
        assertThat(captor.getValue().getQuestion()).isEqualTo("받침이 뭐예요?");
        assertThat(captor.getValue().getAnsweredBy()).isEqualTo(AnsweredBy.LLM);
    }

    @Test
    void quotaIsCheckedBeforeSpendingCredits() {
        member();
        doThrow(new ApiException(HttpStatus.TOO_MANY_REQUESTS, "tutor-quota-exceeded",
                "오늘은 말랑이와 충분히 이야기했어요. 내일 또 만나요!"))
                .when(quota).check(STUDENT_ID);

        assertThatThrownBy(() -> service.ask(student(), new AskRequest(CLASSROOM_ID, "질문")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("내일 또 만나요");

        // 상한을 넘겼으면 호출도 기록도 없다 — 통과시킨 뒤 세면 크레딧이 먼저 나간다
        verify(tutorClient, never()).ask(any(), any(), any(), any());
        verify(messageRepository, never()).save(any());
    }

    @Test
    void llmFailureFallsBackToGuidanceInsteadOfAnError() {
        member();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(null); // 키 없음 또는 호출 실패
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        when(messageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "질문"));

        // 저학년 화면이 에러로 멈추면 안 된다 — 선생님에게 물어보라고 안내한다
        assertThat(response.answer()).contains("선생님");
        assertThat(response.answeredBy()).isEqualTo(AnsweredBy.TEMPLATE);
        // 폴백도 기록한다 — 무엇을 물었는지가 남아야 안전 확인이 된다
        verify(messageRepository).save(any());
    }

    @Test
    void aFallbackAnswerGivesTheQuestionBack() {
        member();
        savesWhatItIsGiven();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(null); // 키 없음 또는 호출 실패

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "질문"));

        /*
          크레딧을 안 썼으니 횟수도 돌려준다. 안 그러면 AI 게이트웨이가 죽은 날 아이는
          안내 문구 30개를 받고 "오늘은 그만"이라는 말을 듣는다 — 답은 한 번도 못 받고.
        */
        assertThat(response.answeredBy()).isEqualTo(AnsweredBy.TEMPLATE);
        verify(quota).refund(STUDENT_ID);
    }

    @Test
    void aRealAnswerSpendsTheQuestion() {
        member();
        savesWhatItIsGiven();
        when(tutorClient.ask(anyString(), any(), any(), any()))
                .thenReturn(TutorReply.of("받침은 글자 아래 자음이에요!"));

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "받침이 뭐예요?"));

        // 답을 받았으면 한 번 쓴 것이 맞다 — 되돌리면 상한이 상한이 아니게 된다
        assertThat(response.answeredBy()).isEqualTo(AnsweredBy.LLM);
        verify(quota, never()).refund(any());
    }

    @Test
    void teachersDoNotUseTheStudentTutor() {
        assertThatThrownBy(() -> service.ask(
                new AuthUser(1L, Role.TEACHER, "김선생"), new AskRequest(CLASSROOM_ID, "질문")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학생");

        verify(tutorClient, never()).ask(any(), any(), any(), any());
    }

    @Test
    void cannotAskInAClassroomYouAreNotIn() {
        when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenThrow(new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));

        assertThatThrownBy(() -> service.ask(student(), new AskRequest(CLASSROOM_ID, "질문")))
                .isInstanceOf(ApiException.class);

        verify(tutorClient, never()).ask(any(), any(), any(), any());
    }

    @Test
    void teacherCanReviewWhatTheStudentAsked() {
        when(accessGuard.requireMember(CLASSROOM_ID, 1L)).thenReturn(ClassroomRole.OWNER);
        List<AiTutorMessage> history = List.of(mock(AiTutorMessage.class));
        when(messageRepository.findByClassroomIdAndStudentIdOrderByCreatedAtDesc(
                CLASSROOM_ID, STUDENT_ID)).thenReturn(history);

        // 저학년이 쓰는 챗봇이라 무엇을 물었는지 선생님이 볼 수 있어야 한다
        assertThat(service.history(new AuthUser(1L, Role.TEACHER, "김선생"),
                CLASSROOM_ID, STUDENT_ID)).hasSize(1);
    }

    @Test
    void studentCanReviewTheirOwnHistory() {
        when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(ClassroomRole.STUDENT);
        when(messageRepository.findByClassroomIdAndStudentIdOrderByCreatedAtDesc(
                CLASSROOM_ID, STUDENT_ID)).thenReturn(List.of());

        assertThat(service.history(student(), CLASSROOM_ID, STUDENT_ID)).isEmpty();
    }

    @Test
    void aStudentReviewingTheirOwnHistoryNeverSeesTheSafetyFlag() {
        // 기록은 미리 만든다 — thenReturn 인자 안에서 mock 을 만들면 스터빙이 겹쳐 깨진다
        List<AiTutorMessage> history = List.of(flaggedMessage());
        when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(ClassroomRole.STUDENT);
        when(messageRepository.findByClassroomIdAndStudentIdOrderByCreatedAtDesc(
                CLASSROOM_ID, STUDENT_ID)).thenReturn(history);

        TutorMessageResponse row = service.history(student(), CLASSROOM_ID, STUDENT_ID).get(0);

        /*
          자기 말이 무엇으로 분류됐는지 아이가 알 이유가 없고, 알면 다음부터 그 표현을
          피해 가려 한다 — 이 기능이 있는 이유 자체가 사라진다. 화면이 안 그린다는 사실에
          기대지 않고 서버에서 지운다.
        */
        assertThat(row.flagged()).isFalse();
        assertThat(row.flagReason()).isNull();
        // 대화 자체는 그대로 보인다 — 지우는 것은 '표시'뿐이다
        assertThat(row.question()).isEqualTo("질문");
        assertThat(row.answer()).isEqualTo("답");
    }

    @Test
    void aTeacherReviewingTheHistorySeesTheSafetyFlag() {
        List<AiTutorMessage> history = List.of(flaggedMessage());
        when(accessGuard.requireMember(CLASSROOM_ID, 1L)).thenReturn(ClassroomRole.OWNER);
        when(messageRepository.findByClassroomIdAndStudentIdOrderByCreatedAtDesc(
                CLASSROOM_ID, STUDENT_ID)).thenReturn(history);

        TutorMessageResponse row = service.history(new AuthUser(1L, Role.TEACHER, "김선생"),
                CLASSROOM_ID, STUDENT_ID).get(0);

        // 어른에게 알리는 경로가 여기다 — 무엇에 걸렸는지까지 보여야 판단할 수 있다
        assertThat(row.flagged()).isTrue();
        assertThat(row.flagReason()).isEqualTo("자해 신호");
    }

    @Test
    void studentCannotReadAnotherStudentsHistory() {
        when(accessGuard.requireMember(CLASSROOM_ID, 99L)).thenReturn(ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service.history(
                new AuthUser(99L, Role.STUDENT, "남의학생"), CLASSROOM_ID, STUDENT_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("본인 또는 학급 선생님");
    }

    @Test
    void profanityIsBlockedBeforeReachingTheLlm() {
        member();
        when(safetyFilter.blockedMessage("씨발"))
                .thenReturn(Optional.of("앗, 그런 말은 말랑이랑 함께 쓰지 않기로 해요."));
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        when(messageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "씨발"));

        // 욕설은 크레딧을 쓰지 않고 막고, 요약에도 접지 않는다
        assertThat(response.answeredBy()).isEqualTo(AnsweredBy.BLOCKED);
        assertThat(response.answer()).contains("말랑이");
        verify(tutorClient, never()).ask(any(), any(), any(), any());
        verify(memoryRepository, never()).save(any());

        // 막힌 말도 기록은 남겨 선생님이 확인할 수 있게 한다
        ArgumentCaptor<AiTutorMessage> captor = ArgumentCaptor.forClass(AiTutorMessage.class);
        verify(messageRepository).save(captor.capture());
        assertThat(captor.getValue().getAnsweredBy()).isEqualTo(AnsweredBy.BLOCKED);
        assertThat(captor.getValue().getQuestion()).isEqualTo("씨발");
    }

    @Test
    void priorSummaryAndRelatedMaterialsAreGivenToTheClient() {
        member();
        AiTutorMemory memory = mock(AiTutorMemory.class);
        when(memory.getSummary()).thenReturn("지난번에 받침을 궁금해했다.");
        when(memory.getUpdatedAt()).thenReturn(LocalDateTime.now().minusMinutes(30));
        when(memoryRepository.findByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.of(memory));
        when(grounding.contextFor(CLASSROOM_ID, "받침이 뭐예요?")).thenReturn("- (받아쓰기) 받침 설명");
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(TutorReply.of("받침은 글자 아래 자음이에요!"));
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        when(messageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.ask(student(), new AskRequest(CLASSROOM_ID, "받침이 뭐예요?"));

        // 이전 요약과 질문 관련 자료가 그대로 클라이언트로 넘어간다
        verify(tutorClient).ask(eq("받침이 뭐예요?"), eq("지난번에 받침을 궁금해했다."), eq("- (받아쓰기) 받침 설명"), any());
    }

    @Test
    void aSummaryOlderThanADayIsNotUsedAsContext() {
        member();
        savesWhatItIsGiven();
        AiTutorMemory stale = mock(AiTutorMemory.class);
        when(stale.getUpdatedAt()).thenReturn(LocalDateTime.now().minusHours(25));
        when(memoryRepository.findByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.of(stale));
        when(tutorClient.ask(anyString(), any(), any(), any()))
                .thenReturn(TutorReply.of("곱셈은 같은 수를 여러 번 더하는 거예요!"));

        service.ask(student(), new AskRequest(CLASSROOM_ID, "곱셈이 뭐예요?"));

        /*
          어제 국어를 묻던 아이가 오늘 수학을 물으면 "받침을 궁금해했다"가 문맥으로 붙어
          답이 그쪽으로 끌려간다. 하루가 학교 생활의 단위라 그 이상 지난 요약은 지금 대화의
          문맥이 아니다. 지우지는 않는다 — 다음 대화에서 새로 덮인다.
        */
        verify(tutorClient).ask(eq("곱셈이 뭐예요?"), isNull(), any(), any());
    }

    // ── 최근 대화 문맥 (요약이 못 하는 일) ──

    @Test
    void theLastThreeTurnsRideAlongOldestFirst() {
        member();
        savesWhatItIsGiven();
        // 리포지토리는 최근 것을 위로 준다 — 대화 순서로 뒤집는 것은 서비스의 일이다
        when(messageRepository.findTop3ByClassroomIdAndStudentIdAndAnsweredByOrderByCreatedAtDesc(
                CLASSROOM_ID, STUDENT_ID, AnsweredBy.LLM))
                .thenReturn(List.of(
                        pastTurn("셋째 질문", "셋째 답"),
                        pastTurn("둘째 질문", "둘째 답"),
                        pastTurn("첫째 질문", "첫째 답")));
        when(tutorClient.ask(anyString(), any(), any(), any()))
                .thenReturn(TutorReply.of("아까 이야기한 받침 말이구나!"));

        service.ask(student(), new AskRequest(CLASSROOM_ID, "그거 다시 설명해줘"));

        /*
          요약만으로는 "그거 다시 설명해줘"가 성립하지 않는다 — 요약은 사실 몇 줄로 줄어든
          것이라 직전 답변의 문장·예시를 되짚을 수 없다. 순서가 뒤집히면 모델이 읽는 대화가
          거꾸로 흐르므로 오래된 것부터인지까지 고정한다.
        */
        verify(tutorClient).ask(anyString(), any(), any(), turnsCaptor.capture());
        assertThat(turnsCaptor.getValue()).containsExactly(
                new Turn("첫째 질문", "첫째 답"),
                new Turn("둘째 질문", "둘째 답"),
                new Turn("셋째 질문", "셋째 답"));
    }

    @Test
    void theFirstQuestionCarriesNoTurnsAtAll() {
        member();
        savesWhatItIsGiven();
        when(messageRepository.findTop3ByClassroomIdAndStudentIdAndAnsweredByOrderByCreatedAtDesc(
                CLASSROOM_ID, STUDENT_ID, AnsweredBy.LLM)).thenReturn(List.of());
        when(tutorClient.ask(anyString(), any(), any(), any()))
                .thenReturn(TutorReply.of("반가워! 무엇이 궁금해?"));

        service.ask(student(), new AskRequest(CLASSROOM_ID, "안녕?"));

        // 처음 온 아이에게 없는 대화를 지어내지 않는다 — null 이 아니라 빈 목록이다
        verify(tutorClient).ask(anyString(), any(), any(), turnsCaptor.capture());
        assertThat(turnsCaptor.getValue()).isEmpty();
    }

    @Test
    void fallbackAndBlockedRepliesNeverBecomeContext() {
        member();
        savesWhatItIsGiven();
        when(tutorClient.ask(anyString(), any(), any(), any()))
                .thenReturn(TutorReply.of("받침은 글자 아래 자음이에요!"));

        service.ask(student(), new AskRequest(CLASSROOM_ID, "받침이 뭐예요?"));

        /*
          폴백(TEMPLATE)은 "지금은 대답하기 어려워요", 차단(BLOCKED)은 고운 말 안내라
          둘 다 대화 내용이 아니다. 그것까지 문맥으로 실으면 모델이 자기가 그렇게 답했다고
          믿고 그 말투를 이어간다. 거르는 자리는 조회 자체다 — LLM 행만 물어본다.
        */
        verify(messageRepository).findTop3ByClassroomIdAndStudentIdAndAnsweredByOrderByCreatedAtDesc(
                CLASSROOM_ID, STUDENT_ID, AnsweredBy.LLM);
        verify(messageRepository, never())
                .findTop3ByClassroomIdAndStudentIdAndAnsweredByOrderByCreatedAtDesc(
                        any(), any(), eq(AnsweredBy.TEMPLATE));
        verify(messageRepository, never())
                .findTop3ByClassroomIdAndStudentIdAndAnsweredByOrderByCreatedAtDesc(
                        any(), any(), eq(AnsweredBy.BLOCKED));
    }

    @Test
    void theConversationIsHandedToTheSummaryUpdaterAfterAnswering() {
        member();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(TutorReply.of("받침은 글자 아래 자음이에요!"));
        when(memoryRepository.findByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        when(messageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.ask(student(), new AskRequest(CLASSROOM_ID, "받침이 뭐예요?"));

        /*
          요약 갱신은 **여기서 기다리지 않는다** — 넘겼는지만 본다.
          이전 요약은 넘기지 않는다: 비동기라 요청 시점의 요약을 들고 가면 연속 질문 두 건이
          같은 옛 요약 위에 각자 새 요약을 만들어 뒤에 끝난 쪽이 앞의 것을 덮는다. 워커가
          직접 읽는다. 실제 요약·저장 동작은 TutorMemoryUpdaterTest 가 검증한다.
        */
        verify(memoryUpdater).update(eq(CLASSROOM_ID), eq(STUDENT_ID),
                eq("받침이 뭐예요?"), eq("받침은 글자 아래 자음이에요!"));
        // 답변 경로에서는 요약 LLM 을 부르지 않는다 — 이게 아이 대기시간을 줄인 핵심이다
        verify(tutorClient, never()).summarize(any(), anyString(), anyString());
    }

    @Test
    void aFallbackAnswerIsNotFoldedIntoTheSummary() {
        member();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(null); // 폴백으로 나간 안내 문구
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        when(messageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.ask(student(), new AskRequest(CLASSROOM_ID, "질문"));

        // 폴백 안내 문구는 문맥이 아니라 요약에 접지 않는다
        verify(memoryUpdater, never()).update(any(), any(), any(), any());
        verify(tutorClient, never()).summarize(any(), anyString(), anyString());
    }

    @Test
    void aFailedSummaryHandoffDoesNotBreakTheAnswer() {
        member();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(TutorReply.of("받침은 글자 아래 자음이에요!"));
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        when(messageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        /*
          요약 전용 실행기는 큐가 차면 AbortPolicy 로 거절한다(요약은 잃어도 되는 작업이라
          되돌아와 답변을 막는 CallerRuns 를 쓰지 않는다). 그때 던져지는 예외가 아이의 답변을
          막아서는 안 된다.
        */
        doThrow(new java.util.concurrent.RejectedExecutionException("queue full"))
                .when(memoryUpdater).update(any(), any(), any(), any());

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "받침이 뭐예요?"));

        assertThat(response.answer()).isEqualTo("받침은 글자 아래 자음이에요!");
        assertThat(response.answeredBy()).isEqualTo(AnsweredBy.LLM);
    }

    // ── 제안 액션 (확인 후 실행) ──

    @Test
    void attachesAskTeacherProposalWithTheTextThatWillBeSent() {
        member();
        savesWhatItIsGiven();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(new TutorReply(
                "그건 선생님께 여쭤보면 좋겠어. 내가 대신 여쭤봐 줄까?",
                new ProposedAction(TutorActionType.ASK_TEACHER, null,
                        null, "민수가 이번 주 받아쓰기 시험 범위를 궁금해합니다.")));

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "시험 범위 알려주세요"));

        // 무엇이 선생님에게 가는지 보여주지 않고 아이에게 확인을 받을 수는 없다
        assertThat(response.proposedAction().type()).isEqualTo(TutorActionType.ASK_TEACHER);
        assertThat(response.proposedAction().content()).contains("받아쓰기 시험 범위를 궁금해합니다");
        assertThat(response.proposedAction().expiresAt()).isAfter(LocalDateTime.now());
        /*
          title 은 더 이상 요구하지 않는다 — 선생님에게 전달할 때도 학생 화면에서도 쓰이지 않는데
          질문마다 생성 토큰만 쓰고 있었다. content 만 있으면 제안은 성립한다.
        */
        assertThat(response.proposedAction().title()).isNull();
    }

    @Test
    void neverProposesShowMaterialEvenWhenTheModelInventedAnId() {
        member();
        savesWhatItIsGiven();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(new TutorReply(
                "우리 반 자료에 나와 있어! 내가 열어 줄까?",
                new ProposedAction(TutorActionType.SHOW_MATERIAL, 9999L, null, null)));

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "겹받침이 뭐야"));

        // 예전에는 학급 자료인지 확인해 보고 없으면 버렸다. 지금은 확인할 것도 없이 안 만든다
        assertThat(response.answer()).isNotBlank();
        assertThat(response.proposedAction()).isNull();
        verify(actionExecutor, never()).findOfferable(any(), any());
    }

    @Test
    void neverProposesShowMaterialEvenForARealClassroomMaterial() {
        member();
        savesWhatItIsGiven();
        when(tutorClient.ask(anyString(), any(), any(), any())).thenReturn(new TutorReply(
                "우리 반 자료에 나와 있어! 내가 열어 줄까?",
                new ProposedAction(TutorActionType.SHOW_MATERIAL, 12L, null, null)));

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "겹받침이 뭐야"));

        /*
          자료가 진짜여도 제안하지 않는다. 학생 화면이 이 제안에 버튼을 만들지 않아
          (AiTutorPanel.isActionable) 아이에게는 "내가 열어 줄까?"라는 말만 보이고 열 방법이
          없었다 — 누를 수 없는 제안은 안 하느니만 못하다.

          만드는 경로만 닫는다: 이미 저장된 PENDING 행은 최대 24시간 남아 있고, 아이가 그걸
          누르면 TutorActionExecutor 가 그대로 실행해 준다(TutorActionExecutorTest 가 지킨다).
        */
        assertThat(response.proposedAction()).isNull();
        verify(actionExecutor, never()).findOfferable(any(), any());
    }

    @Test
    void confirmingRunsTheActionAndMarksItConfirmed() {
        AiTutorMessage message = pendingAskTeacher();
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(message));
        when(actionExecutor.execute(any(), eq(message)))
                .thenReturn(new Result(Delivery.DIRECT_MESSAGE, null, null));

        ActionResultResponse result = service.decideAction(
                student(), MESSAGE_ID, new ActionDecisionRequest(Decision.CONFIRM));

        assertThat(result.status()).isEqualTo(TutorActionStatus.CONFIRMED);
        assertThat(result.delivery()).isEqualTo(Delivery.DIRECT_MESSAGE);
        verify(messageRepository).updateActionStatus(MESSAGE_ID, TutorActionStatus.CONFIRMED);
    }

    @Test
    void rejectingNeverRunsTheAction() {
        AiTutorMessage message = pendingAskTeacher();
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(message));

        ActionResultResponse result = service.decideAction(
                student(), MESSAGE_ID, new ActionDecisionRequest(Decision.REJECT));

        assertThat(result.status()).isEqualTo(TutorActionStatus.REJECTED);
        // 확인 후 실행 — 거절하면 선생님에게 아무것도 가지 않는다
        verify(actionExecutor, never()).execute(any(), any());
        verify(messageRepository).updateActionStatus(MESSAGE_ID, TutorActionStatus.REJECTED);
    }

    @Test
    void cannotDecideSomeoneElsesProposal() {
        // 목을 when(...) 인자 안에서 만들면 스터빙이 중첩돼 Mockito 가 막는다 — 먼저 만든다
        AiTutorMessage message = pendingAskTeacher();
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(message));

        assertThatThrownBy(() -> service.decideAction(
                new AuthUser(99L, Role.STUDENT, "남의학생"), MESSAGE_ID,
                new ActionDecisionRequest(Decision.CONFIRM)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("본인의 제안");

        verify(actionExecutor, never()).execute(any(), any());
    }

    @Test
    void expiredProposalsCannotBeRun() {
        AiTutorMessage message = tutorMessage();
        // 어제 받은 제안을 오늘 눌러 질문이 선생님에게 가면 맥락이 어긋난다
        message.proposeAskTeacher("제목", "본문", LocalDateTime.now().minusMinutes(1));
        when(messageRepository.findById(MESSAGE_ID)).thenReturn(Optional.of(message));

        assertThatThrownBy(() -> service.decideAction(
                student(), MESSAGE_ID, new ActionDecisionRequest(Decision.CONFIRM)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("시간이 지나");

        verify(actionExecutor, never()).execute(any(), any());
    }

    @Test
    void aBlockedQuestionNeverCarriesAProposal() {
        member();
        savesWhatItIsGiven();
        when(safetyFilter.blockedMessage(anyString()))
                .thenReturn(Optional.of("우리 고운 말로 이야기하자!"));

        AnswerResponse response = service.ask(student(), new AskRequest(CLASSROOM_ID, "씨발"));

        // LLM 을 부르지 않았으니 제안할 것도 없다
        assertThat(response.answeredBy()).isEqualTo(AnsweredBy.BLOCKED);
        assertThat(response.proposedAction()).isNull();
        verify(tutorClient, never()).ask(any(), any(), any(), any());
    }

    private void member() {
        lenient().when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(ClassroomRole.STUDENT);
    }

    private AuthUser student() {
        return new AuthUser(STUDENT_ID, Role.STUDENT, "김민수");
    }

    private void savesWhatItIsGiven() {
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        when(messageRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private AiTutorMessage tutorMessage() {
        User student = mock(User.class);
        lenient().when(student.getId()).thenReturn(STUDENT_ID);
        return AiTutorMessage.of(mock(Classroom.class), student, "질문", "답", AnsweredBy.LLM);
    }

    private AiTutorMessage pendingAskTeacher() {
        AiTutorMessage message = tutorMessage();
        message.proposeAskTeacher("제목", "본문", LocalDateTime.now().plusHours(24));
        return message;
    }

    /** 살펴봐야 할 대화로 표시된 기록 — 답은 평소처럼 나간 뒤에 표시만 붙는다. */
    private AiTutorMessage flaggedMessage() {
        AiTutorMessage message = tutorMessage();
        message.flagForTeacher("자해 신호");
        return message;
    }

    /** 문맥으로 실릴 지난 대화 한 줄 — 여기서는 질문·답 원문만 쓰인다. */
    private AiTutorMessage pastTurn(String question, String answer) {
        return AiTutorMessage.of(mock(Classroom.class), mock(User.class),
                question, answer, AnsweredBy.LLM);
    }
}
