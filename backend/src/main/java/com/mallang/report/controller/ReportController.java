package com.mallang.report.controller;

import com.mallang.assignment.dto.AssignmentDtos.GenerateAccepted;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ReportDtos.ClinicRequest;
import com.mallang.report.dto.ReportDtos.ReportResponse;
import com.mallang.report.dto.ScoreTrendDtos.ScoreTrendResponse;
import com.mallang.report.service.ClinicService;
import com.mallang.report.service.ReportService;
import com.mallang.report.service.StudentScoreTrendService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Report", description = "학습 리포트 — 강약점 · 오답 클리닉")
@RestController
@RequestMapping("/api/classrooms/{classroomId}/students/{studentId}")
@RequiredArgsConstructor
public class ReportController {

    private final ReportService reportService;
    private final ClinicService clinicService;
    private final StudentScoreTrendService studentScoreTrendService;

    @Operation(summary = "학습 리포트 (선생님 또는 본인) — 개념별 정답률·강점/약점·코멘트·추천 난이도/활동")
    @GetMapping({"/report", "/understanding"})
    public ReportResponse report(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId) {
        return reportService.report(authUser, classroomId, studentId);
    }

    @Operation(summary = "과제 점수 추이 (선생님 또는 본인) — 과제별 최신 시도, 오래된 것부터")
    @GetMapping("/submissions")
    public ScoreTrendResponse scoreTrend(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId) {
        return studentScoreTrendService.trend(authUser, classroomId, studentId);
    }

    @Operation(summary = "오답 클리닉 생성 (선생님) — 약점 개념 기반 추가 문제, 비동기(202+jobId)")
    @PostMapping("/clinic")
    public ResponseEntity<GenerateAccepted> clinic(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId,
            @RequestBody(required = false) ClinicRequest request) {
        ClinicRequest req = request != null ? request : new ClinicRequest(null, null, null);
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(clinicService.startClinic(authUser, classroomId, studentId,
                        req.type(), req.count(), req.materialIds()));
    }
}
