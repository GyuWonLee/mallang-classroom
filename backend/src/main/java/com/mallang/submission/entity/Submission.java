package com.mallang.submission.entity;

import com.mallang.assignment.entity.Assignment;
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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 과제 제출 (즉시 자동 채점). 재제출은 새 행(attempt_no 증가)으로 모든 시도를 보존한다 (ERD).
 * answers=문항번호→답, results=문항별 정오(집계용 conceptTags 포함), ai_analysis=LLM 해석 캐시.
 */
@Entity
@Table(name = "submission",
        uniqueConstraints = @UniqueConstraint(name = "uq_submission",
                columnNames = {"assignment_id", "student_id", "attempt_no"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Submission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assignment_id", nullable = false)
    private Assignment assignment;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private String answers;

    private Short score;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private String results;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_analysis", columnDefinition = "jsonb")
    private String aiAnalysis;

    /**
     * 과제 전체 AI 총평 (학생 말투). '내 답안 다시보기' 첫 조회에 만들어 여기 캐시한다.
     * ai_analysis 와 다른 칸인 이유는 읽는 사람이 다르기 때문 — 저건 선생님용 해석이다 (V12 주석).
     */
    @Column(columnDefinition = "text")
    private String feedback;

    @Column(name = "attempt_no", nullable = false)
    private int attemptNo;

    @Column(name = "submitted_at", nullable = false)
    private LocalDateTime submittedAt;

    public static Submission create(Assignment assignment, User student, String answers,
                                    Short score, String results, int attemptNo) {
        Submission submission = new Submission();
        submission.assignment = assignment;
        submission.student = student;
        submission.answers = answers;
        submission.score = score;
        submission.results = results;
        submission.attemptNo = attemptNo;
        submission.submittedAt = LocalDateTime.now();
        return submission;
    }

    public void updateAiAnalysis(String aiAnalysis) {
        this.aiAnalysis = aiAnalysis;
    }
}
