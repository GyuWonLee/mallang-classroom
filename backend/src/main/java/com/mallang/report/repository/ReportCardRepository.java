package com.mallang.report.repository;

import com.mallang.report.entity.ReportCard;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ReportCardRepository extends JpaRepository<ReportCard, Long> {

    /** 학급+학생당 한 장 — 있으면 갱신, 없으면 새로. */
    Optional<ReportCard> findByClassroomIdAndStudentId(Long classroomId, Long studentId);

    /** 학급의 저장된 통지표 전부 — "학년 통지표 한 번에 보기"에서 학생별로 매핑한다. */
    List<ReportCard> findByClassroomId(Long classroomId);
}
