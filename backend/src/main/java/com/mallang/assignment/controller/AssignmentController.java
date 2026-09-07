package com.mallang.assignment.controller;

import com.mallang.assignment.dto.AssignmentDtos.AssignmentResponse;
import com.mallang.assignment.dto.AssignmentDtos.AssignmentSummaryResponse;
import com.mallang.assignment.dto.AssignmentDtos.CreateAssignmentRequest;
import com.mallang.assignment.dto.AssignmentDtos.GenerateAccepted;
import com.mallang.assignment.dto.AssignmentDtos.GenerateRequest;
import com.mallang.assignment.dto.AssignmentDtos.GenerationJobResponse;
import com.mallang.assignment.dto.AssignmentDtos.UpdateAssignmentRequest;
import com.mallang.assignment.service.AssignmentGenerationService;
import com.mallang.assignment.service.AssignmentService;
import com.mallang.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Assignment", description = "과제 — 직접 작성 · AI 생성 · 검수/발행")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class AssignmentController {

    private final AssignmentService assignmentService;
    private final AssignmentGenerationService generationService;

    @Operation(summary = "과제 생성/확정 저장 (OWNER/MAINTAINER) — AI 초안 검수 후에도 이 API로 저장")
    @PostMapping("/classrooms/{classroomId}/assignments")
    public ResponseEntity<AssignmentResponse> create(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @Valid @RequestBody CreateAssignmentRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(assignmentService.create(authUser, classroomId, request));
    }

    @Operation(summary = "AI 과제 생성 (비동기, 202 + jobId) — 학습자료 기반 grounding")
    @PostMapping("/classrooms/{classroomId}/assignments/generate")
    public ResponseEntity<GenerateAccepted> generate(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @Valid @RequestBody GenerateRequest request) {
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(generationService.startGeneration(authUser, classroomId, request));
    }

    @Operation(summary = "AI 생성 작업 상태/초안 폴링 (선생님). 만료 시 410")
    @GetMapping("/generation-jobs/{jobId}")
    public GenerationJobResponse job(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable String jobId) {
        return GenerationJobResponse.from(generationService.getJob(authUser, jobId));
    }

    @Operation(summary = "과제 목록 (멤버) — 학생은 공개된 것만")
    @GetMapping("/classrooms/{classroomId}/assignments")
    public List<AssignmentSummaryResponse> list(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return assignmentService.list(authUser, classroomId);
    }

    @Operation(summary = "과제 상세 (멤버) — 문제 content 포함. 학생은 공개된 것만")
    @GetMapping("/assignments/{assignmentId}")
    public AssignmentResponse get(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long assignmentId) {
        return assignmentService.get(authUser, assignmentId);
    }

    @Operation(summary = "과제 수정 (OWNER/MAINTAINER) — 마감일·발행 여부 등")
    @PatchMapping("/assignments/{assignmentId}")
    public AssignmentResponse update(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long assignmentId,
            @Valid @RequestBody UpdateAssignmentRequest request) {
        return assignmentService.update(authUser, assignmentId, request);
    }

    @Operation(summary = "과제 삭제 (OWNER/MAINTAINER, soft delete)")
    @DeleteMapping("/assignments/{assignmentId}")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long assignmentId) {
        assignmentService.delete(authUser, assignmentId);
        return ResponseEntity.noContent().build();
    }
}
