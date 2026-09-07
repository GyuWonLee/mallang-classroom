package com.mallang.tutor.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.tutor.dto.TutorDtos.ActionDecisionRequest;
import com.mallang.tutor.dto.TutorDtos.ActionResultResponse;
import com.mallang.tutor.dto.TutorDtos.AnswerResponse;
import com.mallang.tutor.dto.TutorDtos.AskRequest;
import com.mallang.tutor.dto.TutorDtos.FlaggedStudentResponse;
import com.mallang.tutor.dto.TutorDtos.TutorMessageResponse;
import com.mallang.tutor.service.AiTutorService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "AiTutor", description = "AI 말랑이 — 학생 질문 챗봇")
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class AiTutorController {

    private final AiTutorService aiTutorService;

    @Operation(summary = "말랑이에게 묻기 (학생 전용) — 하루 30회, 실패 시 안내 문구로 대체")
    @PostMapping("/ai/tutor/messages")
    public AnswerResponse ask(
            @AuthenticationPrincipal AuthUser authUser,
            @Valid @RequestBody AskRequest request) {
        return aiTutorService.ask(authUser, request);
    }

    @Operation(summary = "말랑이 제안 확인/거절 (본인 전용) — CONFIRM 이면 그 자리에서 실행",
            description = "말랑이가 제안한 액션(선생님께 질문 전달 / 학습자료 열기)을 확인하거나 거절합니다. "
                    + "확인해야만 실제로 실행됩니다. 제안은 24시간 뒤 만료됩니다(action-expired 409).")
    @PostMapping("/ai/tutor/messages/{messageId}/action")
    public ActionResultResponse decideAction(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long messageId,
            @Valid @RequestBody ActionDecisionRequest request) {
        return aiTutorService.decideAction(authUser, messageId, request);
    }

    @Operation(summary = "살펴봐야 할 대화가 있는 학생 (학급 선생님 전용)",
            description = "자해·폭력 피해·괴롭힘 신호가 담긴 대화가 있는 학생과 건수. "
                    + "사유는 담지 않는다 — 목록 화면에 뜨면 옆 아이도 읽는다. "
                    + "무엇인지는 그 학생의 대화 기록을 열어야 보인다.")
    @GetMapping("/classrooms/{classroomId}/tutor-flags")
    public List<FlaggedStudentResponse> flaggedStudents(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return aiTutorService.flaggedStudents(authUser, classroomId);
    }

    @Operation(summary = "말랑이 대화 기록 (학급 선생님 또는 본인) — 최근 것이 위")
    @GetMapping("/classrooms/{classroomId}/students/{studentId}/tutor-messages")
    public List<TutorMessageResponse> history(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long studentId) {
        return aiTutorService.history(authUser, classroomId, studentId);
    }
}
