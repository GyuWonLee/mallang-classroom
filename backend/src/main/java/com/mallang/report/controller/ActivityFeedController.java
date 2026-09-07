package com.mallang.report.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ActivityDtos.ActivityItem;
import com.mallang.report.service.ActivityFeedService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "Activity", description = "학급 활동 피드 — 오늘의 활동 타임라인")
@RestController
@RequestMapping("/api/classrooms/{classroomId}")
@RequiredArgsConstructor
public class ActivityFeedController {

    private final ActivityFeedService activityFeedService;

    @Operation(summary = "학급 활동 피드 (학급 선생님 전용) — 수업·과제·제출·합류를 시간순으로")
    @GetMapping("/activities")
    public List<ActivityItem> feed(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @RequestParam(defaultValue = "20") int limit) {
        return activityFeedService.feed(authUser, classroomId, limit);
    }
}
