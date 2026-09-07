package com.mallang.file.controller;

import com.mallang.file.dto.FileDtos.UploadResponse;
import com.mallang.file.entity.FilePurpose;
import com.mallang.file.service.FileService;
import com.mallang.file.service.FileService.Download;
import com.mallang.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@Tag(name = "File", description = "파일 — 업로드/인증 다운로드")
@RestController
@RequestMapping("/api/files")
@RequiredArgsConstructor
public class FileController {

    private final FileService fileService;

    @Operation(summary = "파일 업로드 (기본 용도 RECORDING — 학습자료는 학습자료 API 경유)")
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<UploadResponse> upload(
            @AuthenticationPrincipal AuthUser authUser,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "purpose", defaultValue = "RECORDING") FilePurpose purpose) {
        UploadResponse response = fileService.upload(authUser, file, purpose);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Operation(summary = "파일 다운로드/스트리밍 — 소유자 또는 업로더가 속한 학급의 선생님만")
    @GetMapping("/{fileId}/content")
    public ResponseEntity<Resource> content(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable UUID fileId) {
        Download download = fileService.download(authUser, fileId);
        // inline: 브라우저가 <audio>/<img> 로 바로 재생·표시할 수 있게 (첨부 다운로드가 아님)
        ContentDisposition disposition = ContentDisposition.inline()
                .filename(download.fileName(), StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .contentType(MediaType.parseMediaType(download.contentType()))
                .contentLength(download.sizeBytes())
                .body(download.resource());
    }
}
