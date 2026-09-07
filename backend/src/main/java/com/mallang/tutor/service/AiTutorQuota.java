package com.mallang.tutor.service;

import com.mallang.global.error.ApiException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * 학생당 하루 질문 상한 (명세 §11.1 #1 — "비용 상한부터 정해야 한다").
 *
 * <p>호출 하나가 곧 크레딧이라 상한이 없으면 한 학생이 반 전체 몫을 써 버릴 수 있다.
 * 하루 단위로 끊는 이유는 저학년 사용 리듬이 수업일 기준이기 때문이다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiTutorQuota {

    /** 하루 질문 수. 수업 중 궁금한 것을 묻기에는 넉넉하고, 장난으로 태우기에는 모자란 선. */
    static final int DAILY_LIMIT = 30;
    private static final Duration WINDOW = Duration.ofDays(1);
    private static final String KEY_PREFIX = "ai:tutor:quota:";

    private final StringRedisTemplate redis;

    /**
     * 답을 못 만들었을 때 <b>세었던 한 번을 되돌린다.</b>
     *
     * <p>상한은 크레딧을 지키려는 것인데, LLM 호출이 실패하면 크레딧은 안 썼는데 횟수만 줄어든다.
     * AI 키가 없거나 게이트웨이가 죽은 날에는 아이가 <b>답을 한 번도 못 받고 하루가 잠긴다</b> —
     * 안내 문구 30개를 받고 "오늘은 그만"이라는 말을 듣는 셈이다.</p>
     *
     * <p>되돌리기가 실패해도 조용히 넘긴다. 이건 아이에게 유리한 쪽으로 기우는 보정이라,
     * 여기서 예외를 던져 답변 응답을 깨뜨릴 이유가 없다.</p>
     */
    public void refund(Long studentId) {
        try {
            redis.opsForValue().decrement(KEY_PREFIX + studentId);
        } catch (RuntimeException e) {
            log.warn("AI 튜터 사용량 되돌리기 실패 — 이번 한 번은 소모된 채로 둔다. studentId={}",
                    studentId, e);
        }
    }

    public void check(Long studentId) {
        String key = KEY_PREFIX + studentId;
        long used;
        try {
            Long incremented = redis.opsForValue().increment(key);
            used = incremented == null ? 1L : incremented;
            if (used == 1L) {
                // 첫 질문에만 만료를 건다. 매번 걸면 창이 밀려 영원히 초기화되지 않는다.
                redis.expire(key, WINDOW);
            }
        } catch (RuntimeException e) {
            // Redis 가 죽었다고 학습 도구를 막지는 않는다. 대신 흔적을 남겨 비용을 확인할 수 있게 한다.
            log.warn("AI 튜터 사용량 확인 실패 — 이번 요청은 통과시킨다. studentId={}", studentId, e);
            return;
        }
        if (used > DAILY_LIMIT) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "tutor-quota-exceeded",
                    "오늘은 말랑이와 충분히 이야기했어요. 내일 또 만나요!");
        }
    }
}
