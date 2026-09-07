package com.mallang.classroom.entity;

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
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.SQLDelete;
import org.hibernate.annotations.SQLRestriction;

import java.time.LocalDateTime;

/**
 * 권한 모델의 기준점. 모든 학급 API의 권한 검증은 이 테이블의 role로 수행한다.
 * 강퇴 = soft delete, 재가입 = 기존 행 재활성화 (UNIQUE(classroom_id, user_id) 때문).
 */
@Entity
@Table(name = "classroom_member",
        uniqueConstraints = @UniqueConstraint(name = "uq_classroom_member",
                columnNames = {"classroom_id", "user_id"}))
@SQLDelete(sql = "UPDATE classroom_member SET deleted_at = now() WHERE id = ?")
@SQLRestriction("deleted_at is null")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ClassroomMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "classroom_id", nullable = false)
    private Classroom classroom;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ClassroomRole role;

    @Column(nullable = false)
    private LocalDateTime joinedAt;

    private LocalDateTime deletedAt;

    public static ClassroomMember join(Classroom classroom, User user, ClassroomRole role) {
        ClassroomMember member = new ClassroomMember();
        member.classroom = classroom;
        member.user = user;
        member.role = role;
        member.joinedAt = LocalDateTime.now();
        return member;
    }

    /**
     * 역할 변경. 담당자 이양에서만 쓴다 — 이양은 두 행의 역할이 한 번에 바뀌어야 하므로
     * 여기서 값만 바꾸고, 짝이 맞는지는 호출부(ClassroomService#transferOwner)가 책임진다.
     */
    /** 강퇴·탈퇴로 지워진 행인가 — 재가입 경로가 되살릴지 거절할지 가른다 */
    public boolean isDeleted() {
        return deletedAt != null;
    }

    /**
     * 강퇴·탈퇴로 soft delete 된 구성원을 되살린다.
     *
     * <p>이 클래스 주석과 V2__classroom.sql:19 가 "재가입 = 기존 행 재활성화"라고 적어 둔
     * 그 동작이다. {@code uq_classroom_member(classroom_id, user_id)} 가 삭제된 행까지
     * 덮으므로 새 행을 넣으면 유니크 위반이 난다 — 되살리는 것이 유일한 길이다.
     */
    public void restore(ClassroomRole role) {
        this.deletedAt = null;
        this.role = role;
        this.joinedAt = LocalDateTime.now();
    }

    public void changeRole(ClassroomRole role) {
        this.role = role;
    }
}
