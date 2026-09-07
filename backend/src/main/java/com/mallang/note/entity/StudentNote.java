package com.mallang.note.entity;

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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 선생님이 학생에 대해 남기는 메모 (명세 §11.3 #8).
 *
 * <p>읽는 사람이 선생님뿐이라는 점이 이 엔티티의 성격을 정한다 — 학생 본인은 볼 수 없고,
 * 학급 종속이라 학생이 다른 학급으로 가면 따라가지 않는다.</p>
 */
@Entity
@Table(name = "student_note")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StudentNote {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id", nullable = false)
    private User student;

    /** 남긴 선생님. 학급의 다른 선생님도 읽을 수 있지만 고치는 건 이 사람만이다. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "author_id", nullable = false)
    private User author;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    public static StudentNote write(Classroom classroom, User student, User author,
                                    String content) {
        StudentNote note = new StudentNote();
        note.classroom = classroom;
        note.student = student;
        note.author = author;
        note.content = content;
        note.createdAt = LocalDateTime.now();
        note.updatedAt = note.createdAt;
        return note;
    }

    public void edit(String content) {
        this.content = content;
        this.updatedAt = LocalDateTime.now();
    }
}
