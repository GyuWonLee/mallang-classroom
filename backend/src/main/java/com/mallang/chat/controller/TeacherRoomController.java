package com.mallang.chat.controller;

import com.mallang.chat.dto.ChatDtos.MessageResponse;
import com.mallang.chat.dto.ChatDtos.TeacherRoomRequest;
import com.mallang.chat.dto.ChatDtos.TeacherRoomSummary;
import com.mallang.chat.service.TeacherRoomService;
import com.mallang.global.security.AuthUser;
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

/**
 * 학급 교사 단톡방 — 그 학급을 맡은 선생님들만.
 *
 * <p>모든 경로가 OWNER/MAINTAINER 를 요구한다(서비스의 requireManager). 학생은 학급
 * 구성원이어도 403 이다 — 선생님끼리 아이 이야기를 하는 자리라 학생이 읽으면 안 된다.</p>
 */
@Tag(name = "TeacherRoom", description = "학급 교사 단톡방 — 담당 교사 전용")
@RestController
@RequestMapping("/api/classrooms/{classroomId}/chat/teacher-room")
@RequiredArgsConstructor
public class TeacherRoomController {

    private final TeacherRoomService teacherRoomService;

    @Operation(summary = "단톡방 대화 (오래된 것부터)")
    @GetMapping
    public List<MessageResponse> messages(@AuthenticationPrincipal AuthUser authUser,
                                          @PathVariable Long classroomId) {
        return teacherRoomService.messages(authUser, classroomId);
    }

    @Operation(summary = "단톡방 요약 — 마지막 메시지와 안 읽은 수 (목록 화면용)")
    @GetMapping("/summary")
    public TeacherRoomSummary summary(@AuthenticationPrincipal AuthUser authUser,
                                      @PathVariable Long classroomId) {
        return teacherRoomService.summary(authUser, classroomId);
    }

    @Operation(summary = "단톡방 메시지 전송 — 그 학급 다른 교사에게 실시간으로 간다")
    @PostMapping("/messages")
    public ResponseEntity<MessageResponse> send(@AuthenticationPrincipal AuthUser authUser,
                                                @PathVariable Long classroomId,
                                                @Valid @RequestBody TeacherRoomRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(teacherRoomService.send(authUser, classroomId, request));
    }

    @Operation(summary = "여기까지 읽음 — 안 읽은 수가 0이 된다")
    @PostMapping("/read")
    public ResponseEntity<Void> markRead(@AuthenticationPrincipal AuthUser authUser,
                                         @PathVariable Long classroomId) {
        teacherRoomService.markRead(authUser, classroomId);
        return ResponseEntity.noContent().build();
    }
}
