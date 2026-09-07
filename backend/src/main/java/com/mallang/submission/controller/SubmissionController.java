package com.mallang.submission.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.submission.dto.SubmissionDtos.MySubmissionDetailResponse;
import com.mallang.submission.dto.SubmissionDtos.MySubmissionResponse;
import com.mallang.submission.dto.SubmissionDtos.SubmitRequest;
import com.mallang.submission.dto.SubmissionDtos.SubmitResponse;
import com.mallang.submission.service.SubmissionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Submission", description = "과제 제출 — 즉시 자동 채점")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class SubmissionController {

    private final SubmissionService submissionService;

    @Operation(summary = "과제 제출 (학생) — 제출 즉시 자동 채점, 응답에 점수·문항별 정오 포함")
    @PostMapping("/assignments/{assignmentId}/submissions")
    public ResponseEntity<SubmitResponse> submit(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long assignmentId,
            @Valid @RequestBody SubmitRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(submissionService.submit(authUser, assignmentId, request));
    }

    @Operation(summary = "내 제출 목록 (학생) — 과제별 최신 시도. 안 낸 게 없으면 빈 배열")
    @GetMapping("/me/submissions")
    public List<MySubmissionResponse> mySubmissions(@AuthenticationPrincipal AuthUser authUser) {
        return submissionService.mySubmissions(authUser);
    }

    @Operation(summary = "내 답안 상세 (학생) — 최신 시도의 내 답 + 문항별 정오")
    @GetMapping("/assignments/{assignmentId}/submissions/me")
    public MySubmissionDetailResponse mySubmission(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long assignmentId) {
        return submissionService.mySubmission(authUser, assignmentId);
    }
}
