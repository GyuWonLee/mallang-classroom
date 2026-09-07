package com.mallang.classroom.entity;

import com.mallang.global.entity.BaseTimeEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.SQLRestriction;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

// 두 학교를 묶은 가상 통합반. school 컬럼 없음(의도) — 참여 학교는 구성원(USER.school)에서 도출
@Entity
@SQLDelete(sql = "UPDATE classroom SET deleted_at = now() WHERE id = ?")
@SQLRestriction("deleted_at is null")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Classroom extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    // 학생 username 생성 재료 (예: dodam → dodam01). 서버가 단어 풀에서 자동 배정
    @Column(nullable = false, unique = true, length = 30)
    private String alias;

    /**
     * 담당 학년 1~2개. 학생 등록 시 이 학년만 허용한다(팀도 학년 단위로 자동 생성).
     * 비어 있으면 제약하지 않는다 — 학년 도입 전에 만들어진 학급을 막지 않기 위해서다.
     */
    @ElementCollection(fetch = FetchType.LAZY)
    @CollectionTable(name = "classroom_grade",
            joinColumns = @JoinColumn(name = "classroom_id"))
    @Column(name = "grade", nullable = false)
    // 학급 목록은 학급마다 학년을 읽는다 — 배치로 묶지 않으면 학급 수만큼 쿼리가 나간다(N+1)
    @BatchSize(size = 100)
    private Set<Short> grades = new LinkedHashSet<>();

    private LocalDateTime deletedAt;

    public static Classroom create(String name, String alias, Collection<Short> grades) {
        Classroom classroom = new Classroom();
        classroom.name = name;
        classroom.alias = alias;
        classroom.replaceGrades(grades);
        return classroom;
    }

    public void rename(String name) {
        this.name = name;
    }

    public void replaceGrades(Collection<Short> grades) {
        this.grades.clear();
        if (grades != null) {
            // 화면에 "3·4학년"처럼 오름차순으로 보이도록 정렬해 둔다
            grades.stream().sorted().forEach(this.grades::add);
        }
    }

    /** 이 학년의 학생을 받을 수 있는가 — 담당 학년이 비어 있으면(레거시) 제약하지 않는다 */
    public boolean accepts(Short grade) {
        return grades.isEmpty() || grades.contains(grade);
    }
}
