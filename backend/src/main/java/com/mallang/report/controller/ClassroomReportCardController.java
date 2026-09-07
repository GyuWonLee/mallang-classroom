package com.mallang.report.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ReportCardDtos.ReportCardSummary;
import com.mallang.report.service.ReportCardService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 학년 통지표 한 번에 보기 — 학급 학생들의 통지표를 (학년으로 걸러) 한 번에 조회한다.
 * 복식학급에서 한 학년 통지표를 한 화면에 모으기 위한 배치 조회 엔드포인트.
 */
@Tag(name = "ReportCard", description = "생활통지표 — 학년 단위 배치 조회")
@RestController
@RequestMapping("/api/classrooms/{classroomId}/report-cards")
@RequiredArgsConstructor
public class ClassroomReportCardController {

    private final ReportCardService reportCardService;

    @Operation(summary = "학년 통지표 목록 (선생님) — grade 로 학년을 걸러 학생별 통지표를 한 번에 반환")
    @GetMapping
    public List<ReportCardSummary> list(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @RequestParam(required = false) Short grade) {
        return reportCardService.list(authUser, classroomId, grade);
    }
}
