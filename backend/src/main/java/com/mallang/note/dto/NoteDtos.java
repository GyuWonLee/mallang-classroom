package com.mallang.note.dto;

import com.mallang.note.entity.StudentNote;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;

/** 학생 메모 (명세 §11.3 #8) — 선생님만 읽고 쓴다. */
public class NoteDtos {

    public record WriteNoteRequest(
            @NotBlank @Size(max = 2000) String content
    ) {}

    /**
     * authorName 을 함께 내려주는 이유: 학급에 선생님이 여럿이면 "누가 본 것인지"가
     * 메모 내용만큼 중요하다. editable 은 지금 보는 사람이 고칠 수 있는지(= 작성자인지)다.
     */
    public record NoteResponse(
            Long id,
            String content,
            Long authorId,
            String authorName,
            boolean editable,
            LocalDateTime createdAt,
            LocalDateTime updatedAt
    ) {
        public static NoteResponse of(StudentNote note, Long viewerId) {
            return new NoteResponse(
                    note.getId(),
                    note.getContent(),
                    note.getAuthor().getId(),
                    note.getAuthor().getName(),
                    note.getAuthor().getId().equals(viewerId),
                    note.getCreatedAt(),
                    note.getUpdatedAt());
        }
    }
}
