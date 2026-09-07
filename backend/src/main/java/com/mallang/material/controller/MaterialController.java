package com.mallang.material.controller;

import com.mallang.assignment.entity.Subject;
import com.mallang.global.security.AuthUser;
import com.mallang.material.dto.MaterialDtos.MaterialDetailResponse;
import com.mallang.material.dto.MaterialDtos.MaterialSummaryResponse;
import com.mallang.material.dto.MaterialDtos.MaterialUploadResponse;
import com.mallang.material.service.MaterialService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@Tag(name = "Material", description = "학습자료 — AI 과제 생성의 근거 자료")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class MaterialController {

    private final MaterialService materialService;

    @Operation(summary = "학습자료 PDF 업로드 (OWNER/MAINTAINER) — 202, 추출은 비동기")
    @PostMapping(value = "/classrooms/{classroomId}/materials",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<MaterialUploadResponse> upload(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @RequestParam("file") MultipartFile file,
            /* 둘 다 선택이다 — 비우면 공용 자료가 되어 어느 학년·과목에서도 고를 수 있다 */
            @RequestParam(value = "grade", required = false) Short grade,
            @RequestParam(value = "subject", required = false) Subject subject) {
        MaterialUploadResponse response =
                materialService.upload(authUser, classroomId, file, grade, subject);
        return ResponseEntity.accepted().body(response);
    }

    @Operation(summary = "학습자료 목록 (상태 포함)")
    @GetMapping("/classrooms/{classroomId}/materials")
    public List<MaterialSummaryResponse> list(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return materialService.list(authUser, classroomId);
    }

    @Operation(summary = "학습자료 상태 + 추출 텍스트 미리보기 (업로드 후 폴링용)")
    @GetMapping("/materials/{materialId}")
    public MaterialDetailResponse get(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long materialId) {
        return materialService.get(authUser, materialId);
    }

    @Operation(summary = "미리보기 확인 → READY (이후 AI 과제 생성에 사용 가능)")
    @PostMapping("/materials/{materialId}/confirm")
    public MaterialDetailResponse confirm(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long materialId) {
        return materialService.confirm(authUser, materialId);
    }

    @Operation(summary = "학습자료 삭제 (soft delete — 기존 과제가 참조)")
    @DeleteMapping("/materials/{materialId}")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long materialId) {
        materialService.delete(authUser, materialId);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }
}
