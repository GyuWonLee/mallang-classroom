package com.mallang.assignment.entity;

import com.mallang.classroom.entity.Classroom;
import com.mallang.global.entity.BaseTimeEntity;
import com.mallang.user.entity.User;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.SQLRestriction;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 과제. published_at NULL = 초안(학생에게 안 보임) — AI 초안 확정도 이 값을 찍는 것으로 표현.
 * content·sourceMaterialIds는 JSONB 문자열로 보관 (유형 추가 시 마이그레이션 불필요, ERD 설계 원칙).
 */
@Entity
@SQLDelete(sql = "UPDATE assignment SET deleted_at = now() WHERE id = ?")
@SQLRestriction("deleted_at is null")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Assignment extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by", nullable = false)
    private User createdBy;

    @Column(nullable = false)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Subject subject;

    /** 학년(1~6). 직접 작성 과제는 null 일 수 있다 — 화면이 "1학년 국어"처럼 표시하는 데 쓴다. */
    private Integer grade;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AssignmentType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AssignmentSource source;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private String content;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "source_material_ids", columnDefinition = "jsonb")
    private String sourceMaterialIds;

    private LocalDateTime dueAt;

    private LocalDateTime publishedAt;

    private LocalDateTime deletedAt;

    /**
     * 공개 대상 학년(복식학급용). 비어 있으면 학년 제한 없음.
     */
    @ElementCollection
    @CollectionTable(name = "assignment_target_grade",
            joinColumns = @JoinColumn(name = "assignment_id"))
    @Column(name = "grade")
    private Set<Short> targetGrades = new LinkedHashSet<>();

    /**
     * 공개 대상 학생. 비어 있으면 학생 제한 없음.
     */
    @ElementCollection
    @CollectionTable(name = "assignment_target",
            joinColumns = @JoinColumn(name = "assignment_id"))
    @Column(name = "student_id")
    private Set<Long> targetStudentIds = new LinkedHashSet<>();

    /**
     * 공개 대상 — 학년/학생 지정을 함께 담는다. <b>둘 다 비어 있으면 학급 전체</b>(하위호환).
     * 접근 제어의 축이라 목록·열람·제출에서 모두 이 값으로 거른다.
     */
    public record Targets(Set<Short> grades, Set<Long> studentIds) {
        public static Targets none() {
            return new Targets(Set.of(), Set.of());
        }
    }

    public static Assignment create(Classroom classroom, User createdBy, String title,
                                    Subject subject, Integer grade, AssignmentType type,
                                    AssignmentSource source, String content,
                                    String sourceMaterialIds, LocalDateTime dueAt,
                                    Targets targets) {
        Assignment assignment = new Assignment();
        assignment.classroom = classroom;
        assignment.createdBy = createdBy;
        assignment.title = title;
        assignment.subject = subject;
        assignment.grade = grade;
        assignment.type = type;
        assignment.source = source;
        assignment.content = content;
        assignment.sourceMaterialIds = sourceMaterialIds;
        assignment.dueAt = dueAt;
        if (targets != null) {
            if (targets.grades() != null) {
                assignment.targetGrades.addAll(targets.grades());
            }
            if (targets.studentIds() != null) {
                assignment.targetStudentIds.addAll(targets.studentIds());
            }
        }
        return assignment;
    }

    /**
     * 이 학생에게 보이는가 — 대상(학년·학생)이 둘 다 비어 있으면 누구에게나,
     * 지정돼 있으면 학생의 <b>학년이 대상 학년</b>이거나 <b>본인이 대상 학생</b>일 때 보인다(합집합).
     */
    public boolean isVisibleTo(Long studentId, Short studentGrade) {
        if (targetGrades.isEmpty() && targetStudentIds.isEmpty()) {
            return true;
        }
        return (studentGrade != null && targetGrades.contains(studentGrade))
                || targetStudentIds.contains(studentId);
    }

    public boolean isPublished() {
        return publishedAt != null;
    }

    /** 발행 — 학생에게 노출. 이미 발행됐으면 시각을 덮어쓰지 않는다. */
    public void publish() {
        if (publishedAt == null) {
            publishedAt = LocalDateTime.now();
        }
    }

    public void unpublish() {
        publishedAt = null;
    }

    public void updateDueAt(LocalDateTime dueAt) {
        this.dueAt = dueAt;
    }

    public void updateTitle(String title) {
        this.title = title;
    }

    /**
     * 문제(content JSON)를 통째로 교체 — 선생님이 검토 후 문제를 빼거나 더한 결과를 저장한다.
     * 발행 여부 판단은 서비스가 한다(공개된 과제는 학생이 이미 풀었을 수 있어 여기서 막지 않고 서비스에서 막는다).
     */
    public void updateContent(String content) {
        this.content = content;
    }
}
