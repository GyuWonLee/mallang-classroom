package com.mallang.material.repository;

import com.mallang.material.entity.Material;
import com.mallang.material.entity.MaterialStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface MaterialRepository extends JpaRepository<Material, Long> {

    /** 선생님 목록용 — 상태와 무관하게 전부. 추출 중·실패도 보여야 선생님이 손을 쓸 수 있다. */
    @Query("select m from Material m where m.classroom.id = :classroomId order by m.id desc")
    List<Material> findByClassroomId(@Param("classroomId") Long classroomId);

    @Query("""
            select new com.mallang.material.repository.MaterialTitleView(m.id, m.title)
            from Material m
            where m.classroom.id = :classroomId and m.status = :status
            order by m.id desc
            """)
    List<MaterialTitleView> findTitleViews(@Param("classroomId") Long classroomId,
                                           @Param("status") MaterialStatus status);

    @Query("""
            select new com.mallang.material.repository.MaterialTextView(m.id, m.title, m.extractedText)
            from Material m
            where m.classroom.id = :classroomId
              and m.status = :status
              and m.extractedText is not null
            order by m.id desc
            """)
    List<MaterialTextView> findTextViews(@Param("classroomId") Long classroomId,
                                         @Param("status") MaterialStatus status);

    /**
     * 말랑이가 아이에게 <b>열어 줄 수 있는</b> 자료 목록 (제목만).
     *
     * <p>{@link MaterialStatus#READY} 만인 이유: PREVIEW 는 선생님이 아직 추출 결과를 확인하지
     * 않은 상태이고(상태 머신이 PREVIEW 를 두는 이유 자체가 그것이다), FAILED 는 깨진 텍스트다.
     */
    default List<MaterialTitleView> findReadyTitles(Long classroomId) {
        return findTitleViews(classroomId, MaterialStatus.READY);
    }

    /**
     * 답변 근거로 쓸 자료 본문 — READY 이고 본문이 있는 것만, 최신순.
     *
     * <p>최신순인 이유: 호출부가 상한을 두고 앞에서부터 끊는데, 오래된 자료보다 최근 올린 자료가
     * 지금 수업과 가까울 확률이 높다.
     */
    default List<MaterialTextView> findReadyTexts(Long classroomId) {
        return findTextViews(classroomId, MaterialStatus.READY);
    }
}
