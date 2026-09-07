package com.mallang.file.controller;

import com.mallang.file.dto.FileDtos.UploadResponse;
import com.mallang.file.service.TtsService;
import com.mallang.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 텍스트→음성 (명세 §9). 학생이 문제별 버튼으로 호출 → 응답 url 을 GET /api/files/{id}/content 로 재생.
 * 응답은 파일 도메인과 동일한 UploadResponse(fileId, url) shape.
 */
@Tag(name = "TTS", description = "문제별 텍스트→음성 생성")
@RestController
@RequiredArgsConstructor
public class TtsController {

    private final TtsService ttsService;

    @Operation(summary = "텍스트 → 음성 (온디맨드). 받아쓰기=정답 문장, 그 외=발문/보기 — 읽을 텍스트는 프론트가 결정")
    @PostMapping("/api/tts")
    public UploadResponse tts(
            @AuthenticationPrincipal AuthUser authUser,
            @Valid @RequestBody TtsRequest request) {
        return ttsService.synthesize(authUser, request.text(), request.voice());
    }

    public record TtsRequest(
            @NotBlank @Size(max = 1000) String text,
            String voice   // 선택 — null이면 provider 기본 음성
    ) {}
}
