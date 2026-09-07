package com.mallang.report.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.HeatmapDtos.AssignmentSubmissionsResponse;
import com.mallang.report.dto.HeatmapDtos.ClassHeatmapResponse;
import com.mallang.report.service.AssignmentSubmissionsService;
import com.mallang.report.service.ClassHeatmapService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 학급 단위 분석 (명세 §8) — 개인 리포트(ReportController)와 달리 반 전체를 훑는 화면용.
 * 둘 다 선생님 전용이다.
 */
@Tag(name = "Analytics", description = "학급 분석 — 히트맵 · 과제별 제출 현황")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class ClassAnalyticsController {

    private final ClassHeatmapService classHeatmapService;
    private final AssignmentSubmissionsService assignmentSubmissionsService;

    @Operation(summary = "학급 히트맵 (선생님) — 학생 × 개념태그 매트릭스, 셀은 신호등 밴드")
    @GetMapping("/classrooms/{classroomId}/understanding")
    public ClassHeatmapResponse heatmap(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return classHeatmapService.heatmap(authUser, classroomId);
    }

    @Operation(summary = "과제별 제출 현황 (선생님) — 미제출자 + 문항별 정답률·오답 분포")
    @GetMapping("/assignments/{assignmentId}/submissions")
    public AssignmentSubmissionsResponse submissions(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long assignmentId) {
        return assignmentSubmissionsService.submissions(authUser, assignmentId);
    }
}
