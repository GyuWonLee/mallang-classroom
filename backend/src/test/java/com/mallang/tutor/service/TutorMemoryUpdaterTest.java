package com.mallang.tutor.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 요약 갱신은 {@code AiTutorService} 에서 여기로 옮겨졌다 — 답변을 막지 않고 뒤에서 돌게 하려면
 * {@code @Async} 가 프록시를 타야 하고, 그러려면 다른 빈이어야 하기 때문이다.
 * 실제 요약·저장 동작의 검증도 함께 옮겨 온다.
 *
 * <p>DB 접촉은 {@link TutorMemoryStore} 로 한 번 더 갈라졌다({@code @Transactional} 도 프록시를
 * 타야 하므로). 그래서 여기서는 저장소를 목으로 세우고 <b>워커가 무엇을 읽어 무엇을 저장하는지</b>
 * 만 본다 — 리포지토리·엔티티는 저장소 쪽 관심사다.</p>
 */
@ExtendWith(MockitoExtension.class)
class TutorMemoryUpdaterTest {

    private static final Long CLASSROOM_ID = 1L;
    private static final Long STUDENT_ID = 7L;

    @Mock AiTutorClient tutorClient;
    @Mock TutorMemoryStore store;

    @InjectMocks TutorMemoryUpdater updater;

    @Test
    @DisplayName("대화를 요약해 새 기억으로 저장한다")
    void foldsTheConversationIntoANewMemory() {
        when(tutorClient.summarize(any(), anyString(), anyString()))
                .thenReturn("학생이 받침을 궁금해했고 개념을 배웠다.");

        updater.update(CLASSROOM_ID, STUDENT_ID, "받침이 뭐예요?", "받침은 글자 아래 자음이에요!");

        verify(store).save(CLASSROOM_ID, STUDENT_ID, "학생이 받침을 궁금해했고 개념을 배웠다.");
    }

    @Test
    @DisplayName("요약이 비면 아무것도 저장하지 않는다")
    void savesNothingWhenTheSummaryIsBlank() {
        when(tutorClient.summarize(any(), anyString(), anyString())).thenReturn("  ");

        updater.update(CLASSROOM_ID, STUDENT_ID, "질문", "답");

        verify(store, never()).save(any(), any(), any());
    }

    @Test
    @DisplayName("저장이 터져도 예외를 밖으로 던지지 않는다 — 답은 이미 학생에게 나갔다")
    void swallowsFailuresBecauseTheAnswerIsAlreadyOut() {
        when(tutorClient.summarize(any(), anyString(), anyString())).thenReturn("요약");
        doThrow(new RuntimeException("db down")).when(store).save(any(), any(), anyString());

        assertThatCode(() ->
                updater.update(CLASSROOM_ID, STUDENT_ID, "질문", "답"))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("이전 요약은 인자로 받지 않고 워커 안에서 저장 직전에 다시 읽는다")
    void readsThePriorSummaryInsideTheWorkerRightBeforeSaving() {
        // 호출부가 넘겨 주던 값이 아니라, 저장소가 지금 들고 있는 값이 요약 재료가 되어야 한다
        when(store.currentSummary(CLASSROOM_ID, STUDENT_ID)).thenReturn("앞 질문까지 반영된 요약");
        when(tutorClient.summarize(any(), anyString(), anyString())).thenReturn("갱신된 요약");

        updater.update(CLASSROOM_ID, STUDENT_ID, "된소리는요?", "된소리는 세게 나는 소리예요!");

        verify(tutorClient).summarize(eq("앞 질문까지 반영된 요약"), eq("된소리는요?"), anyString());
        // 읽기가 저장보다 먼저여야 방금 저장된 남의 갱신을 놓치지 않는다
        InOrder order = inOrder(store);
        order.verify(store).currentSummary(CLASSROOM_ID, STUDENT_ID);
        order.verify(store).save(eq(CLASSROOM_ID), eq(STUDENT_ID), anyString());
    }

    @Test
    @DisplayName("연속 질문 두 건에서 뒤엣것이 앞엣것을 덮지 않는다 — 둘 다 쌓인다")
    void theSecondQuestionStacksOnTheFirstInsteadOfOverwritingIt() {
        /*
          회귀: 예전에는 호출부가 "요청 시점의 요약"을 인자로 넘겼다. 비동기라 같은 학생의 질문
          두 건이 이어지면 둘 다 같은 옛 요약(여기서는 null)을 재료로 받아, 나중에 끝난 쪽이
          앞의 갱신을 통째로 덮었다 — 연속으로 물어볼수록 대화가 더 잘 사라졌다.
          워커가 저장 직전에 읽으면 두 번째는 첫 번째가 저장한 요약 위에 쌓인다.
        */
        List<String> savedSummaries = new ArrayList<>();
        when(store.currentSummary(CLASSROOM_ID, STUDENT_ID))
                .thenAnswer(call -> savedSummaries.isEmpty()
                        ? null
                        : savedSummaries.get(savedSummaries.size() - 1));
        doAnswer(call -> {
            savedSummaries.add(call.getArgument(2));
            return null;
        }).when(store).save(eq(CLASSROOM_ID), eq(STUDENT_ID), anyString());
        // 가짜 LLM: 받은 이전 요약 뒤에 이번 질문을 붙여 준다 — 재료를 무엇으로 받았는지가 결과에 남는다
        when(tutorClient.summarize(any(), anyString(), anyString()))
                .thenAnswer(call -> {
                    String priorSummary = call.getArgument(0);
                    String question = call.getArgument(1);
                    return priorSummary == null ? question : priorSummary + " / " + question;
                });

        updater.update(CLASSROOM_ID, STUDENT_ID, "받침이 뭐예요?", "받침은 글자 아래 자음이에요!");
        updater.update(CLASSROOM_ID, STUDENT_ID, "된소리는요?", "된소리는 세게 나는 소리예요!");

        assertThat(savedSummaries).hasSize(2);
        assertThat(savedSummaries.get(1))
                .contains("받침이 뭐예요?")
                .contains("된소리는요?");
    }

    @Test
    @DisplayName("행 생성이 겹쳐 저장이 튕기면 이미 만든 요약을 그대로 다시 저장한다 — 크레딧을 두 번 쓰지 않는다")
    void retriesWithTheSummaryItAlreadyPaidForWhenTheRowRacedIn() {
        when(tutorClient.summarize(any(), anyString(), anyString())).thenReturn("요약");
        // 먼저 넣은 쪽이 uq_ai_tutor_memory 를 이미 차지했다 → 첫 저장만 튕기고 재시도는 통과
        doThrow(new DataIntegrityViolationException("uq_ai_tutor_memory"))
                .doNothing()
                .when(store).save(CLASSROOM_ID, STUDENT_ID, "요약");

        updater.update(CLASSROOM_ID, STUDENT_ID, "질문", "답");

        // 실패한 것은 저장뿐이다. 예전에는 여기서 summarize 를 한 번 더 불러 크레딧을 두 번 썼다
        verify(tutorClient, times(1)).summarize(any(), anyString(), anyString());
        verify(store, times(2)).save(CLASSROOM_ID, STUDENT_ID, "요약");
    }
}
