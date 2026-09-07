package com.mallang.user.entity;

import com.mallang.global.entity.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.Check;
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.SQLRestriction;

import java.time.LocalDateTime;

// "user"는 PostgreSQL 예약어라 테이블명은 users
@Entity
@Table(name = "users")
@SQLDelete(sql = "UPDATE users SET deleted_at = now() WHERE id = ?")
@SQLRestriction("deleted_at is null")
@Check(constraints = "(role = 'STUDENT' AND grade IS NOT NULL) OR (role = 'TEACHER' AND grade IS NULL)")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 선생님: 이메일 / 학생: 자동 생성 아이디({학급alias}{번호})
    @Column(nullable = false, unique = true)
    private String username;

    @Column(nullable = false)
    private String password;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    // 선생님: 재직학교 / 학생: 소속학교
    @Column(nullable = false)
    private String school;

    // 학생만 (CHECK 제약으로 강제) — 팀 자동 배정 기준
    private Short grade;

    // 학생만 (CHECK 제약으로 강제) — 계정 안내 메일 수신처. 없으면 종이 안내장만 나간다
    private String parentEmail;

    private LocalDateTime deletedAt;

    public static User createTeacher(String email, String encodedPassword, String name, String school) {
        User user = new User();
        user.username = email;
        user.password = encodedPassword;
        user.name = name;
        user.role = Role.TEACHER;
        user.school = school;
        return user;
    }

    /** 학부모 이메일 없이 — 초대 코드로 학생이 직접 가입하는 경로 */
    public static User createStudent(String username, String encodedPassword, String name,
                                     String school, short grade) {
        return createStudent(username, encodedPassword, name, school, grade, null);
    }

    public static User createStudent(String username, String encodedPassword, String name,
                                     String school, short grade, String parentEmail) {
        User user = new User();
        user.username = username;
        user.password = encodedPassword;
        user.name = name;
        user.role = Role.STUDENT;
        user.school = school;
        user.grade = grade;
        user.parentEmail = parentEmail;
        return user;
    }

    public void changePassword(String encodedPassword) {
        this.password = encodedPassword;
    }

    public boolean isTeacher() {
        return this.role == Role.TEACHER;
    }
}
