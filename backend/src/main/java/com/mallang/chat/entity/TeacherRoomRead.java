package com.mallang.chat.entity;

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
 * 교사 단톡방에서 사람별로 어디까지 읽었는지.
 *
 * <p>1:1 은 {@code chat_message.read_at} 하나로 충분했다 — 받는 사람이 한 명이라 행과 독자가
 * 1:1 이었다. 단톡방은 한 메시지를 여럿이 읽으므로 그 자리에 담을 수 없다. 대신 사람마다
 * <b>마지막으로 읽은 시각</b> 하나만 들고, 그보다 뒤에 온 메시지를 안 읽은 것으로 센다.
 * 메시지 수만큼 행이 늘지 않아 방이 길어져도 비용이 일정하다.</p>
 *
 * <p>행이 없으면 "한 번도 읽지 않음"이다 — 초대되자마자 그동안 쌓인 대화가 전부 안 읽음으로
 * 잡히는 것이 자연스럽다.</p>
 */
@Entity
@Table(name = "teacher_room_read",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_teacher_room_read_classroom_user",
                columnNames = {"classroom_id", "user_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TeacherRoomRead {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "last_read_at", nullable = false)
    private LocalDateTime lastReadAt;

    public static TeacherRoomRead of(Classroom classroom, User user, LocalDateTime lastReadAt) {
        TeacherRoomRead read = new TeacherRoomRead();
        read.classroom = classroom;
        read.user = user;
        read.lastReadAt = lastReadAt;
        return read;
    }

    /**
     * 뒤로 감기지 않는다. 읽음 처리가 늦게 도착해도(재전송·순서 뒤바뀜) 이미 읽은 구간이
     * 다시 안 읽음으로 돌아가면 안 된다.
     */
    public void advanceTo(LocalDateTime readAt) {
        if (readAt != null && readAt.isAfter(lastReadAt)) {
            lastReadAt = readAt;
        }
    }
}
