package com.mallang.invite.entity;

import com.mallang.classroom.entity.Classroom;
import com.mallang.user.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
 * 학급 초대. 유효 조건 = expires_at > now AND revoked_at IS NULL AND used_count < max_uses.
 * 코드는 다회용이며 수락 때마다 used_count 가 증가한다.
 */
@Entity
@Table(name = "invite")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Invite {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @Column(nullable = false, unique = true)
    private String code;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private InviteType type;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by", nullable = false)
    private User createdBy;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    @Column(nullable = false)
    private int maxUses;

    @Column(nullable = false)
    private int usedCount;

    private LocalDateTime revokedAt;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    public static Invite issue(Classroom classroom, User createdBy, InviteType type,
                               String code, LocalDateTime expiresAt, int maxUses) {
        Invite invite = new Invite();
        invite.classroom = classroom;
        invite.createdBy = createdBy;
        invite.type = type;
        invite.code = code;
        invite.expiresAt = expiresAt;
        invite.maxUses = maxUses;
        invite.usedCount = 0;
        invite.createdAt = LocalDateTime.now();
        return invite;
    }

    /**
     * 아직 쓸 수 있는 초대인가.
     *
     * <p>{@code maxUses} 가 0 이하면 <b>횟수 제한이 없다</b>({@link InviteType#UNLIMITED}).
     * 선생님 초대가 그렇다 — 링크를 붙여 두고 오는 대로 들어오는 물건이라, 한 번 쓰면
     * 사라지면 부를 때마다 새로 만들어야 했다. 그때도 만료와 회수는 그대로 막는다.</p>
     */
    public boolean isUsable(LocalDateTime now) {
        if (revokedAt != null || !expiresAt.isAfter(now)) {
            return false;
        }
        return maxUses <= InviteType.UNLIMITED || usedCount < maxUses;
    }

    public void revoke() {
        this.revokedAt = LocalDateTime.now();
    }

    /** 수락 1회 소진. 호출 전에 isUsable 로 확인한다 (조회는 비관적 락) */
    public void use() {
        this.usedCount++;
    }
}
