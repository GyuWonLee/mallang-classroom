package com.mallang.team.entity;

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

@Entity
@Table(name = "team_member",
        uniqueConstraints = {
                @UniqueConstraint(name = "uq_team_member_team_user",
                        columnNames = {"team_id", "user_id"}),
                @UniqueConstraint(name = "uq_team_member_classroom_user",
                        columnNames = {"classroom_id", "user_id"})
        })
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TeamMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "team_id", nullable = false)
    private Team team;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false)
    private LocalDateTime joinedAt;

    public static TeamMember join(Team team, Classroom classroom, User user) {
        TeamMember member = new TeamMember();
        member.team = team;
        member.classroom = classroom;
        member.user = user;
        member.joinedAt = LocalDateTime.now();
        return member;
    }
}
