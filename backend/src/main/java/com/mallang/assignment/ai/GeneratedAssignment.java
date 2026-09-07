package com.mallang.assignment.ai;

import java.util.List;

/**
 * LLM 생성 결과. status가 "rejected"면 문항 생성 외 요청·빈 자료 등으로 거절된 것.
 * 정상이면 서비스가 problems를 명세 §7의 content JSON으로 조립한다.
 * choices/answer는 객관식·OX·선택형에서, answerText는 받아쓰기에서 채워진다.
 */
public record GeneratedAssignment(String status, String rejectReason, String title, List<Problem> problems) {

    public record Problem(
            int no,
            String prompt,          // 발문 (받아쓰기는 읽어줄 문장)
            List<String> choices,   // 선택형만 (받아쓰기는 null)
            Integer answer,         // 선택형 정답 인덱스 (받아쓰기는 null)
            String answerText,      // 받아쓰기 정답 텍스트 (선택형은 null)
            List<String> conceptTags,
            Integer level,          // 1~3 난이도
            String sourceMaterialId,// 근거 자료 ID
            String sourceQuote      // 근거 원문 인용 (자료 원문 그대로)
    ) {
    }

    public boolean rejected() {
        return "rejected".equalsIgnoreCase(status);
    }

    /**
     * 거절 응답이거나 문항이 비면 예외 — 호출부(비동기 러너)가 잡아 작업을 FAILED로 기록한다.
     * 거절은 {@link GenerationRejectedException} 으로 던져 '자료가 부적합' 같은 안내로 바꿀 수 있게 하고,
     * 그 외(문항 0개)는 일반 오류로 둔다.
     */
    public void validate() {
        if (rejected()) {
            throw new GenerationRejectedException(rejectReason);
        }
        if (problems == null || problems.isEmpty()) {
            throw new GenerationRejectedException("문항을 만들 수 있는 내용이 아닙니다");
        }
    }
}
