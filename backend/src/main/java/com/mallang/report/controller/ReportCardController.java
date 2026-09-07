package com.mallang.report.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ReportCardDtos.EmailReportCardRequest;
import com.mallang.report.dto.ReportCardDtos.EmailReportCardResponse;
import com.mallang.report.dto.ReportCardDtos.ReportCardResponse;
import com.mallang.report.dto.ReportCardDtos.SaveReportCardRequest;
import com.mallang.report.service.ReportCardService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "ReportCard", description = "생활통지표 — 과목별 평가요소(LLM 초안)·평가 등급")
@RestController
@RequestMapping("/api/classrooms/{classroomId}/students/{studentId}/report-card")
@RequiredArgsConstructor
public class ReportCardController {

    private final ReportCardService reportCardService;

    @Operation(summary = "통지표 초안 (선생님) — 과목별 평가요소를 학생 제출 기반으로 LLM 이 채워 반환")
    @PostMapping("/draft")
    public ReportCardResponse draft(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId) {
        return reportCardService.draft(authUser, classroomId, studentId);
    }

    @Operation(summary = "통지표 저장 (선생님) — 수정한 평가요소·평가를 통째로 저장")
    @PutMapping
    public ReportCardResponse save(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId,
            @Valid @RequestBody SaveReportCardRequest request) {
        return reportCardService.save(authUser, classroomId, studentId, request);
    }

    @Operation(summary = "통지표 조회 (학급 선생님 또는 본인) — 저장 전이면 빈 통지표")
    @GetMapping
    public ReportCardResponse get(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId) {
        return reportCardService.get(authUser, classroomId, studentId);
    }

    @Operation(summary = "통지표 이메일 발송 (선생님) — 수신 주소로 전송, PDF(base64) 있으면 첨부")
    @PostMapping("/email")
    public EmailReportCardResponse email(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId,
            @Valid @RequestBody EmailReportCardRequest request) {
        return reportCardService.email(authUser, classroomId, studentId, request);
    }
}
