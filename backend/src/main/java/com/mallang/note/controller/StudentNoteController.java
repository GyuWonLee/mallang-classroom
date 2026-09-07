package com.mallang.note.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.note.dto.NoteDtos.NoteResponse;
import com.mallang.note.dto.NoteDtos.WriteNoteRequest;
import com.mallang.note.service.StudentNoteService;
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

@Tag(name = "StudentNote", description = "학생 메모 — 선생님 전용 (학생 본인은 볼 수 없다)")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class StudentNoteController {

    private final StudentNoteService noteService;

    @Operation(summary = "학생 메모 목록 (학급 선생님 전용) — 최근 것이 위")
    @GetMapping("/classrooms/{classroomId}/students/{studentId}/notes")
    public List<NoteResponse> list(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId) {
        return noteService.list(authUser, classroomId, studentId);
    }

    @Operation(summary = "학생 메모 작성 (학급 선생님 전용)")
    @PostMapping("/classrooms/{classroomId}/students/{studentId}/notes")
    public ResponseEntity<NoteResponse> write(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId,
            @Valid @RequestBody WriteNoteRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(noteService.write(authUser, classroomId, studentId, request));
    }

    @Operation(summary = "학생 메모 수정 (작성자 전용)")
    @PatchMapping("/notes/{noteId}")
    public NoteResponse edit(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long noteId,
            @Valid @RequestBody WriteNoteRequest request) {
        return noteService.edit(authUser, noteId, request);
    }

    @Operation(summary = "학생 메모 삭제 (작성자 전용)")
    @DeleteMapping("/notes/{noteId}")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long noteId) {
        noteService.delete(authUser, noteId);
        return ResponseEntity.noContent().build();
    }
}
