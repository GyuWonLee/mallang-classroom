package com.mallang.session.entity;

import com.mallang.user.entity.User;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/** 출석. LiveKit 웹훅이 기록하며, 재입장은 새 행으로 이력을 보존한다. */
@Entity
@Table(name = "session_participant")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SessionParticipant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "session_id", nullable = false)
    private LiveSession session;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false)
    private LocalDateTime joinedAt;

    private LocalDateTime leftAt;

    public static SessionParticipant join(LiveSession session, User user) {
        SessionParticipant participant = new SessionParticipant();
        participant.session = session;
        participant.user = user;
        participant.joinedAt = LocalDateTime.now();
        return participant;
    }

    public void leave() {
        this.leftAt = LocalDateTime.now();
    }
}