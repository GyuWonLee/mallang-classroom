package com.mallang.tutor.entity;

import com.mallang.classroom.entity.Classroom;
import com.mallang.user.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * AI 말랑이와 주고받은 한 번의 질문·답 (명세 §11.1 #1).
 *
 * <p>스레드를 만들지 않는다 — 한 번의 질문·답이 완결된 단위다. 문맥을 이어붙이면 호출마다
 * 토큰이 누적돼 비용이 커지고, 앞선 대화에 섞인 지시가 뒤 응답에 영향을 주는 통로가 된다.</p>
 */
@Entity
@Table(name = "ai_tutor_message")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AiTutorMessage {

    /**
     * 답을 누가 만들었는지 — 폴백으로 나간 답을 LLM 품질로 오해하지 않기 위해 남긴다.
     * BLOCKED 는 안전 필터가 막아 LLM 을 부르지 않은 경우 — 선생님이 무슨 말을 했는지 확인할 수 있게 구분한다.
     */
    public enum AnsweredBy { LLM, TEMPLATE, BLOCKED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    @Column(nullable = false, columnDefinition = "text")
    private String question;

    @Column(nullable = false, columnDefinition = "text")
    private String answer;

    @Enumerated(EnumType.STRING)
    @Column(name = "answered_by", nullable = false, length = 20)
    private AnsweredBy answeredBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** 제안 액션 — 없으면 전부 null (대부분의 질문은 제안 없이 끝난다). */
    @Enumerated(EnumType.STRING)
    @Column(name = "action_type", length = 20)
    private TutorActionType actionType;

    @Enumerated(EnumType.STRING)
    @Column(name = "action_status", length = 20)
    private TutorActionStatus actionStatus;

    @Column(name = "action_title", length = 200)
    private String actionTitle;

    @Column(name = "action_content", columnDefinition = "text")
    private String actionContent;

    @Column(name = "action_material_id")
    private Long actionMaterialId;

    @Column(name = "action_expires_at")
    private LocalDateTime actionExpiresAt;

    /**
     * 선생님이 살펴봐야 할 대화인가 — 자해·폭력 피해·괴롭힘 신호.
     *
     * <p>답변을 막는 것과는 <b>다른 축</b>이다. {@link AnsweredBy#BLOCKED} 는 "욕설이라
     * LLM 을 부르지 않았다"이고, 이 값은 "답은 정상적으로 나갔지만 어른이 봐야 한다"이다.
     * 그래서 {@code answeredBy} 에 값을 하나 더 넣지 않고 별도 칼럼으로 둔다.
     */
    @Column(nullable = false)
    private boolean flagged;

    @Column(name = "flag_reason", length = 50)
    private String flagReason;

    public static AiTutorMessage of(Classroom classroom, User student, String question,
                                    String answer, AnsweredBy answeredBy) {
        AiTutorMessage message = new AiTutorMessage();
        message.classroom = classroom;
        message.student = student;
        message.question = question;
        message.answer = answer;
        message.answeredBy = answeredBy;
        message.createdAt = LocalDateTime.now();
        return message;
    }

    /**
     * 살펴봐야 할 대화로 표시한다. <b>답변에는 영향을 주지 않는다</b> — 아이는 평소와 똑같은
     * 답을 받고, 표시는 선생님 화면에서만 보인다.
     */
    public void flagForTeacher(String reason) {
        this.flagged = true;
        this.flagReason = reason;
    }

    /** 선생님에게 보낼 질문을 제안으로 붙인다. 실제 발송은 학생이 확인한 뒤에만 일어난다. */
    public void proposeAskTeacher(String title, String content, LocalDateTime expiresAt) {
        this.actionType = TutorActionType.ASK_TEACHER;
        this.actionStatus = TutorActionStatus.PENDING;
        this.actionTitle = title;
        this.actionContent = content;
        this.actionExpiresAt = expiresAt;
    }

    /** 열어 줄 자료를 제안으로 붙인다. materialId 는 호출 전에 학급 자료인지 검증돼 있어야 한다. */
    public void proposeShowMaterial(Long materialId, String title, LocalDateTime expiresAt) {
        this.actionType = TutorActionType.SHOW_MATERIAL;
        this.actionStatus = TutorActionStatus.PENDING;
        this.actionTitle = title;
        this.actionMaterialId = materialId;
        this.actionExpiresAt = expiresAt;
    }

    public boolean hasPendingAction() {
        return actionType != null && actionStatus == TutorActionStatus.PENDING;
    }

    /**
     * 만료를 상태로 저장하지 않고 물어볼 때마다 판정한다 — 배치를 두지 않으려는 선택이고,
     * PENDING 인 채로 남은 행이 곧 '아이가 누르지 않은 제안'이라는 기록이 된다.
     */
    public boolean isActionExpired(LocalDateTime now) {
        return actionExpiresAt != null && now.isAfter(actionExpiresAt);
    }
}
