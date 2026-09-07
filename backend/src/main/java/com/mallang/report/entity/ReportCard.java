package com.mallang.report.entity;

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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * 생활통지표 — 학급+학생당 한 장. 과목·영역별 평가를 content(jsonb) 에 담는다:
 * {@code {"entries":[{subject, area, evalElement, rating}]}}. 표 구조가 유연해 컬럼 대신 문서로 둔다.
 */
@Entity
@Table(name = "report_card",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_report_card", columnNames = {"classroom_id", "student_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ReportCard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private String content;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public static ReportCard of(Classroom classroom, User student, String content) {
        ReportCard card = new ReportCard();
        card.classroom = classroom;
        card.student = student;
        card.content = content;
        card.updatedAt = LocalDateTime.now();
        return card;
    }

    /** 선생님이 저장할 때마다 통째로 교체한다(이력은 쌓지 않고 최신 한 장만). */
    public void updateContent(String content) {
        this.content = content;
        this.updatedAt = LocalDateTime.now();
    }
}
