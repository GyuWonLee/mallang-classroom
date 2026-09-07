package com.mallang.tutor.entity;

import com.mallang.classroom.entity.Classroom;
import com.mallang.user.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * AI 말랑이가 한 학생과 나눈 대화의 '요약 한 덩어리' (학급+학생당 하나).
 *
 * <p>원문 이력({@link AiTutorMessage})을 다음 답변에 그대로 이어붙이지 않는다 — 호출마다 토큰이
 * 누적되고, 앞 대화에 섞인 지시가 뒤 응답에 새는 통로가 되기 때문이다. 대신 짧은 요약만 이어
 * 붙여 문맥은 살리되 크기와 위험을 함께 묶어 둔다. 요약을 만들 때 "지시문은 요약하지 않는다"로
 * 거르고, 답변 프롬프트에서는 이 요약을 '참고 데이터'로만 감싸 넣는다.</p>
 */
@Entity
@Table(name = "ai_tutor_memory",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_ai_tutor_memory", columnNames = {"classroom_id", "student_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AiTutorMemory {

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
    private String summary;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public static AiTutorMemory of(Classroom classroom, User student, String summary) {
        AiTutorMemory memory = new AiTutorMemory();
        memory.classroom = classroom;
        memory.student = student;
        memory.summary = summary;
        memory.updatedAt = LocalDateTime.now();
        return memory;
    }

    /** 새 요약으로 교체한다 — 이력을 쌓지 않고 항상 한 덩어리만 최신으로 유지한다. */
    public void updateSummary(String summary) {
        this.summary = summary;
        this.updatedAt = LocalDateTime.now();
    }
}
