package com.mallang.session.entity;

import com.mallang.classroom.entity.Classroom;
import com.mallang.user.entity.User;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/** 수업. ended_at NULL = 진행중. 진행중 상태(손들기·프레즌스·보드)는 Redis에 있다. */
@Entity
@Table(name = "live_session")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LiveSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "started_by", nullable = false)
    private User startedBy;

    /**
     * 이 수업이 맡은 학년. **한 학급에서 학년별로 수업을 따로 돌리기 위한 구분자다** —
     * 복식학급에서 1학년은 A 선생님이, 3학년은 B 선생님이 동시에 진행할 수 있다.
     *
     * <p>null 은 <b>학급 전체 수업</b>이다. V31 이전에 만들어진 수업이 그렇고, 그 수업은
     * 같은 학급의 어떤 학년 수업과도 겹칠 수 없다(SessionService.start 가 막는다).</p>
     */
    private Short grade;

    @Column(nullable = false)
    private LocalDateTime startedAt;

    private LocalDateTime endedAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private String boardSnapshot;

    /** 학년을 지정하지 않은 수업 = 학급 전체. 이 열이 생기기 전과 같은 뜻이다. */
    public static LiveSession start(Classroom classroom, User teacher) {
        return start(classroom, teacher, null);
    }

    public static LiveSession start(Classroom classroom, User teacher, Short grade) {
        LiveSession session = new LiveSession();
        session.classroom = classroom;
        session.startedBy = teacher;
        session.grade = grade;
        session.startedAt = LocalDateTime.now();
        return session;
    }

    public void end(String boardSnapshot) {
        this.endedAt = LocalDateTime.now();
        this.boardSnapshot = boardSnapshot;
    }
}