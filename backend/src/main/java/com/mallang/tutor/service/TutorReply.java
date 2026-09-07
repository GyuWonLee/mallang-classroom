package com.mallang.tutor.service;

import com.mallang.tutor.entity.TutorActionType;

/**
 * 말랑이의 한 번의 응답 — 아이에게 보일 문장과, 있으면 제안 액션.
 *
 * @param answer     아이에게 그대로 보이는 한국어 문장 (기계 용어가 섞이면 안 된다)
 * @param action     제안 액션. 없으면 null — 대부분의 질문은 여기가 null 이다.
 */
public record TutorReply(String answer, ProposedAction action) {

    public static TutorReply of(String answer) {
        return new TutorReply(answer, null);
    }

    /**
     * @param materialId SHOW_MATERIAL 일 때만. <b>LLM 이 고른 값이라 아직 믿을 수 없다</b> —
     *                   서비스가 학급의 살아있는 자료인지 확인한 뒤에야 저장된다.
     * @param title      ASK_TEACHER 일 때 선생님에게 갈 제목
     * @param content    ASK_TEACHER 일 때 선생님에게 갈 본문
     */
    public record ProposedAction(TutorActionType type, Long materialId,
                                 String title, String content) {
    }
}
