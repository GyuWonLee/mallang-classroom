package com.mallang.session.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.AttendanceDtos.AttendanceResponse;
import com.mallang.session.service.SessionAttendanceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Attendance", description = "출석 — 학생별 수업 참여 이력")
@RestController
@RequestMapping("/api/classrooms/{classroomId}/students/{studentId}")
@RequiredArgsConstructor
public class AttendanceController {

    private final SessionAttendanceService attendanceService;

    @Operation(summary = "학생별 출석 (선생님 또는 본인) — 결석한 수업도 함께 내려준다")
    @GetMapping("/attendance")
    public AttendanceResponse attendance(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId) {
        return attendanceService.attendance(authUser, classroomId, studentId);
    }
}
