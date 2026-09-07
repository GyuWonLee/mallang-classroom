package com.mallang.tutor.dto;

import com.mallang.tutor.entity.AiTutorMessage;
import com.mallang.tutor.entity.AiTutorMessage.AnsweredBy;
import com.mallang.tutor.entity.TutorActionStatus;
import com.mallang.tutor.entity.TutorActionType;
import com.mallang.tutor.service.TutorActionExecutor.Delivery;
import com.mallang.tutor.service.TutorActionExecutor.Result;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;

/** AI 말랑이 (명세 §11.1 #1). */
public class TutorDtos {

    /**
     * classroomId 를 받는 이유: 권한(그 학급 학생인가)과 기록의 소속을 정하는 기준이다.
     * 질문 길이를 막는 것은 비용 상한의 일부다 — 토큰이 그대로 크레딧이다.
     */
    public record AskRequest(
            @NotNull Long classroomId,
            @NotBlank @Size(max = 500) String question
    ) {}

    /**
     * 말랑이가 제안한 액션. 아이에게 "응/아니" 를 묻기 위한 정보만 담는다.
     *
     * <p>ASK_TEACHER 면 <b>선생님에게 실제로 갈 문장</b>(title·content)을 그대로 내려준다 —
     * 무엇이 전달되는지 보여주지 않고 아이에게 확인을 받을 수는 없다.</p>
     */
    public record ProposedActionResponse(
            TutorActionType type,
            String title,
            String content,
            Long materialId,
            LocalDateTime expiresAt
    ) {
        static ProposedActionResponse from(AiTutorMessage message) {
            return new ProposedActionResponse(
                    message.getActionType(), message.getActionTitle(), message.getActionContent(),
                    message.getActionMaterialId(), message.getActionExpiresAt());
        }
    }

    /**
     * answeredBy 를 노출하는 이유: 폴백 안내를 AI 답으로 오해하지 않게 하기 위해서다.
     * messageId 는 제안을 확인·거절할 때 쓴다(제안이 없어도 내려준다 — 기록 참조에 쓰인다).
     */
    public record AnswerResponse(
            Long messageId,
            String answer,
            AnsweredBy answeredBy,
            ProposedActionResponse proposedAction
    ) {
        public static AnswerResponse of(AiTutorMessage message) {
            return new AnswerResponse(message.getId(), message.getAnswer(), message.getAnsweredBy(),
                    message.hasPendingAction() ? ProposedActionResponse.from(message) : null);
        }
    }

    /** 제안 확인/거절 — 확인 후 실행 모델의 '확인' 쪽. */
    public record ActionDecisionRequest(@NotNull Decision decision) {
        public enum Decision { CONFIRM, REJECT }
    }

    /** 열어 줄 자료 — SHOW_MATERIAL 을 확인했을 때만 채워진다. */
    public record MaterialTarget(Long id, String title) {}

    /**
     * 실행 결과. delivery 는 ASK_TEACHER 일 때만 — 수업 중이었는지에 따라 화면 문구가 갈린다
     * ("선생님께 전달했어요" vs "선생님 쪽지함에 남겼어요").
     */
    public record ActionResultResponse(
            Long messageId,
            TutorActionStatus status,
            TutorActionType actionType,
            Delivery delivery,
            MaterialTarget material
    ) {
        public static ActionResultResponse rejected(AiTutorMessage message) {
            return new ActionResultResponse(message.getId(), TutorActionStatus.REJECTED,
                    message.getActionType(), null, null);
        }

        public static ActionResultResponse confirmed(AiTutorMessage message, Result result) {
            MaterialTarget target = result.materialId() == null
                    ? null
                    : new MaterialTarget(result.materialId(), result.materialTitle());
            return new ActionResultResponse(message.getId(), TutorActionStatus.CONFIRMED,
                    message.getActionType(), result.delivery(), target);
        }
    }

    /**
     * 학급에서 살펴봐야 할 대화가 있는 학생 — 선생님 화면의 배지.
     *
     * <p>사유(무엇에 걸렸는지)는 여기 담지 않는다. 목록 화면에 "자해 신호"가 이름 옆에
     * 뜨면 옆 아이도 읽는다. 무엇인지는 그 학생의 대화 기록을 열어야 보인다.
     */
    public record FlaggedStudentResponse(Long studentId, long count) {
    }

    public record TutorMessageResponse(
            Long id,
            String question,
            String answer,
            AnsweredBy answeredBy,
            TutorActionType actionType,
            TutorActionStatus actionStatus,
            LocalDateTime createdAt,
            /** 선생님이 살펴봐야 할 대화인가 — 학생 본인 화면에는 쓰지 않는다 */
            boolean flagged,
            String flagReason
    ) {
        /**
         * @param forTeacher 선생님이 보는 조회인가. <b>학생 본인 조회에는 안전 신호를 내리지
         *                   않는다</b> — 자기 말이 무엇으로 분류됐는지 아이가 알 이유가 없고,
         *                   알면 그 표현을 피해 가려 한다. 화면이 안 그린다는 사실에 기대지 않고
         *                   서버에서 지운다.
         */
        public static TutorMessageResponse from(AiTutorMessage message, boolean forTeacher) {
            return new TutorMessageResponse(message.getId(), message.getQuestion(),
                    message.getAnswer(), message.getAnsweredBy(),
                    message.getActionType(), message.getActionStatus(), message.getCreatedAt(),
                    forTeacher && message.isFlagged(),
                    forTeacher ? message.getFlagReason() : null);
        }
    }
}
