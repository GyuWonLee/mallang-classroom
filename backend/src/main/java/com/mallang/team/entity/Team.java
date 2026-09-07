package com.mallang.team.entity;

import com.mallang.classroom.entity.Classroom;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.SQLRestriction;

import java.time.LocalDateTime;

@Entity
@Table(name = "team")
@SQLDelete(sql = "UPDATE team SET deleted_at = now() WHERE id = ?")
@SQLRestriction("deleted_at is null")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Team {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @Column(nullable = false)
    private String name;

    private Short grade;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime deletedAt;

    /** 학년별 자동 팀 — 팀 = 학급 내 같은 학년 그룹 (기획 확정, 수동 편성은 후순위) */
    public static Team gradeTeam(Classroom classroom, short grade) {
        Team team = new Team();
        team.classroom = classroom;
        team.name = grade + "학년";
        team.grade = grade;
        team.createdAt = LocalDateTime.now();
        return team;
    }
}
