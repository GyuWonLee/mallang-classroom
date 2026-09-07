package com.mallang.tutor.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/**
 * 말랑이 대화 요약 갱신 — <b>답변을 내보낸 뒤</b> 뒤에서 돈다.
 *
 * <p>왜 별도 빈인가: 요약 갱신은 원래 {@code AiTutorService.ask()} 안에서 동기로 돌았다.
 * 그래서 아이가 질문하면 <b>답변 LLM 왕복이 끝난 뒤 요약 LLM 왕복이 또 끝나야</b> 글자가
 * 떴다. 클래스 주석은 "답을 막지 않는다"고 적어 뒀지만 실제로는 예외만 삼켰을 뿐 지연은
 * 그대로 아이에게 갔다. 게이트웨이 읽기 타임아웃이 20초라 최악에는 40초를 기다린다.
 *
 * <p>{@code @Async} 는 프록시를 거쳐야 동작하므로 <b>같은 클래스의 메서드에 붙이면 아무
 * 효과가 없다</b>(자기호출은 프록시를 타지 않는다). 그래서 빈을 분리했다.
 *
 * <p>요약은 다음 질문 때나 쓰이는 값이라, 실패해도 답변에는 영향이 없다. 예외를 밖으로
 * 던지지 않고 로그만 남긴다 — 다음 대화에서 다시 시도된다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TutorMemoryUpdater {

    private final AiTutorClient tutorClient;
    private final TutorMemoryStore store;

    /**
     * 요약 갱신 — <b>이전 요약을 인자로 받지 않고 워커 안에서 다시 읽는다.</b>
     *
     * <p>예전에는 호출부가 요청 시점의 요약을 넘겼다. 그런데 이 일은 비동기라, 같은 학생의
     * 질문 두 건이 이어지면 <b>둘 다 같은 옛 요약 위에</b> 각자 새 요약을 만들어 나중에 끝난
     * 쪽이 앞의 것을 통째로 덮었다 — 연속으로 물어볼수록 대화가 더 잘 사라진다. 연속 질문이야말로
     * 문맥이 가장 필요한 순간인데 거기서 가장 잘 깨지고 있었다.</p>
     *
     * <p>워커 안에서 읽으면 앞의 갱신이 이미 저장된 뒤라 그 위에 쌓인다.</p>
     */
    @Async("tutorSummaryExecutor")
    public void update(Long classroomId, Long studentId, String question, String answer) {
        String newSummary;
        try {
            newSummary = tutorClient.summarize(store.currentSummary(classroomId, studentId), question, answer);
        } catch (RuntimeException e) {
            log.warn("말랑이 대화 요약 생성 실패 — 이번 대화는 요약에 반영하지 못했다. studentId={}",
                    studentId, e);
            return;
        }
        if (newSummary == null || newSummary.isBlank()) {
            return;
        }
        try {
            store.save(classroomId, studentId, newSummary);
        } catch (DataIntegrityViolationException e) {
            /*
              uq_ai_tutor_memory(classroom_id, student_id) 위반.
              같은 학생의 질문 두 건이 거의 동시에 들어오면 find-or-create 가 겹칠 수 있다.
              동기로 돌 때는 창이 좁아 드물었지만 비동기로 빼면서 넓어졌다.
              먼저 넣은 쪽이 이미 행을 만들었다는 뜻이므로, 다시 읽어 덮어쓴다.
            */
            log.debug("요약 행 생성이 겹쳤다 — 기존 행에 덮어쓴다. studentId={}", studentId);
            try {
                // **이미 만든 요약을 다시 쓴다.** 예전에는 여기서 summarize 를 한 번 더 불러
                // 방금 만든 결과를 버리고 크레딧을 두 번 썼다. 실패한 것은 저장뿐이다.
                store.save(classroomId, studentId, newSummary);
            } catch (RuntimeException retryFailed) {
                log.warn("말랑이 요약 재시도 실패. studentId={}", studentId, retryFailed);
            }
        } catch (RuntimeException e) {
            log.warn("말랑이 대화 요약 저장 실패 — 이번 대화는 요약에 반영하지 못했다. studentId={}",
                    studentId, e);
        }
    }

}
