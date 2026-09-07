package com.mallang.invite.repository;

import com.mallang.invite.entity.Invite;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface InviteRepository extends JpaRepository<Invite, Long> {

    boolean existsByCode(String code);

    /** 미리보기용 조회 — 읽기만 하므로 수락과 달리 락을 걸지 않는다. */
    Optional<Invite> findByCode(String code);

    /**
     * 수락용 조회 — 비관적 락. used_count 증가가 읽기·쓰기로 나뉘므로 락 없이는
     * 동시 가입에서 max_uses 를 넘길 수 있다 (명세 §3 원자적 증가 요건).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from Invite i where i.code = :code")
    Optional<Invite> findByCodeForUpdate(@Param("code") String code);

    /**
     * 유효한 초대 목록 (만료·회수·소진 제외).
     *
     * <p>{@code maxUses <= 0} 은 <b>횟수 무제한</b>이라 소진 조건에서 뺀다(InviteType.UNLIMITED).
     * 이 조건이 없으면 무제한 초대가 첫 사용 즉시 목록에서 사라진다 — 링크는 살아 있는데
     * 화면에는 없는 상태가 된다.</p>
     */
    @Query("select i from Invite i where i.classroom.id = :classroomId "
            + "and i.revokedAt is null and i.expiresAt > :now "
            + "and (i.maxUses <= 0 or i.usedCount < i.maxUses) "
            + "order by i.id desc")
    List<Invite> findUsableByClassroomId(@Param("classroomId") Long classroomId,
                                         @Param("now") LocalDateTime now);
}
