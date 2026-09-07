package com.mallang.submission.dto;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import jakarta.validation.constraints.NotNull;
import tools.jackson.databind.JsonNode;

import java.time.LocalDateTime;

/** 제출 요청/응답 DTO. */
public class SubmissionDtos {

    /** answers = 문항번호(문자열) → 답. 선택형은 정답 인덱스(숫자), 받아쓰기는 텍스트. 예: {"1":0,"2":"학교에 갔다"} */
    public record SubmitRequest(
            @NotNull JsonNode answers
    ) {}

    /** 제출 즉시 채점 결과 (명세 §7). results = 문항별 정오. */
    public record SubmitResponse(
            Long submissionId,
            Short score,
            int correctCount,
            int totalCount,
            JsonNode results
    ) {}

    /**
     * 내 제출 목록 항목 — 같은 과제를 여러 번 냈어도 최신 시도만 담는다.
     * 학생이 "내가 뭘 냈고 몇 점이었나"를 훑는 화면용이라 답안 본문은 넣지 않는다(상세에서).
     */
    public record MySubmissionResponse(
            Long submissionId,
            Long assignmentId,
            String assignmentTitle,
            Subject subject,
            AssignmentType type,
            Short score,
            int attemptNo,
            LocalDateTime submittedAt
    ) {}

    /**
     * 내 답안 상세 — 최신 시도. answers = 내가 쓴 답, results = 문항별 정오.
     * "내가 뭘 틀렸는지" 되돌아보는 화면의 데이터.
     */
    public record MySubmissionDetailResponse(
            Long submissionId,
            Long assignmentId,
            String assignmentTitle,
            Short score,
            int attemptNo,
            LocalDateTime submittedAt,
            JsonNode answers,
            JsonNode results,
            String feedback   // 과제 전체 AI 총평(학생 말투). 문항 결과 없으면 null
    ) {}
}
