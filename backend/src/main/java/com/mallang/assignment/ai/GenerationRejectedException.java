package com.mallang.assignment.ai;

/**
 * LLM 이 문항 생성을 '거절'했을 때 (자료가 부적합하다는 등). 시스템 오류와 구분하기 위한 타입이다 —
 * 이걸 잡은 곳(비동기 러너)은 스택트레이스 대신 <b>선생님이 무엇을 하면 되는지</b> 안내로 바꿔 준다.
 *
 * <p>{@link #reason()} 은 프롬프트가 정한 4가지 거절 사유 중 하나(원문)다. 화면 문구 매핑에 쓴다.</p>
 */
public class GenerationRejectedException extends RuntimeException {

    private final String reason;

    public GenerationRejectedException(String reason) {
        super("AI가 생성을 거절했습니다: " + (reason != null ? reason : "사유 미상"));
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
