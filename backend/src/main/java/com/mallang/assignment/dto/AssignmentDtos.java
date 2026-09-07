package com.mallang.assignment.dto;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.entity.AssignmentSource;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.service.GenerationJob;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import tools.jackson.databind.JsonNode;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 과제 도메인 요청/응답 DTO 모음. content/draft는 유형별 스키마가 달라 JsonNode로 그대로 전달한다.
 */
public class AssignmentDtos {

    /** 직접 작성 또는 AI 초안 검수 후 확정 저장. publish=true면 즉시 발행. */
    public record CreateAssignmentRequest(
            @NotBlank @Size(max = 255) String title,
            @NotNull Subject subject,
            @Min(1) @Max(6) Integer grade,    // 학년(1~6). 직접 작성이면 null 가능
            @NotNull AssignmentType type,
            AssignmentSource source,          // null이면 MANUAL
            List<String> sourceMaterialIds,   // AI 확정 저장 시 근거 자료 ID
            @NotNull JsonNode content,        // { "problems": [ ... ] }
            LocalDateTime dueAt,
            Boolean publish,
            // 공개 대상 학년(복식학급). 지정하면 그 학년만. 비었고 학생 대상도 없으면,
            // grade 가 있으면 그 학년으로 자동 한정하고(1학년 문제→1학년만), grade 도 없으면 학급 전체.
            List<Short> targetGrades,
            List<Long> targetStudentIds       // 공개 대상 학생. 지정하면 그 학생(+대상 학년)만
    ) {
        public AssignmentSource sourceOrDefault() {
            return source != null ? source : AssignmentSource.MANUAL;
        }
    }

    /**
     * 마감일 변경·발행/발행취소·문제 편집. 필드가 null이면 해당 항목은 변경하지 않는다.
     * content(문제 검토 후 삭제/추가 결과)는 <b>미발행(초안)일 때만</b> 교체할 수 있다 —
     * 공개된 과제의 문제를 바꾸면 이미 푼 학생과 어긋나므로 서비스에서 409로 막는다.
     */
    public record UpdateAssignmentRequest(
            @Size(max = 255) String title,
            LocalDateTime dueAt,
            Boolean publish,
            JsonNode content              // { "problems": [ ... ] } — null이면 문제 미변경
    ) {
    }

    public record GenerateRequest(
            @NotNull Subject subject,
            @NotNull AssignmentType type,
            @NotNull @Min(1) @Max(6) Integer grade,
            @NotNull @Min(1) @Max(30) Integer count,
            // 개수 상한이 없으면 자료당 상한만으로는 개수만큼 곱해진다.
            // 실제 화면에서 한 번에 고르는 자료는 한두 개다 (MaterialSource 가 글자 수도 제한한다).
            @NotEmpty @Size(max = 5, message = "학습자료는 한 번에 5개까지 고를 수 있어요.")
            List<String> materialIds
    ) {
    }

    public record GenerateAccepted(String jobId) {
    }

    public record GenerationJobResponse(String jobId, String status, JsonNode draft, String error) {
        public static GenerationJobResponse from(GenerationJob job) {
            return new GenerationJobResponse(job.jobId(), job.status().name(), job.draft(), job.error());
        }
    }

    public record AssignmentResponse(
            Long id,
            Long classroomId,
            String title,
            Subject subject,
            Integer grade,
            AssignmentType type,
            AssignmentSource source,
            List<String> sourceMaterialIds,
            JsonNode content,
            LocalDateTime dueAt,
            LocalDateTime publishedAt,
            Long createdBy,
            LocalDateTime createdAt,
            List<Short> targetGrades,       // 공개 대상 학년(선생님 확인용). 비면 학년 제한 없음
            List<Long> targetStudentIds     // 공개 대상 학생(선생님 확인용). 학년·학생 둘 다 비면 학급 전체
    ) {
        public static AssignmentResponse of(Assignment a, JsonNode content, List<String> sourceMaterialIds) {
            return new AssignmentResponse(a.getId(), a.getClassroom().getId(), a.getTitle(),
                    a.getSubject(), a.getGrade(), a.getType(), a.getSource(), sourceMaterialIds, content,
                    a.getDueAt(), a.getPublishedAt(), a.getCreatedBy().getId(), a.getCreatedAt(),
                    new ArrayList<>(a.getTargetGrades()), new ArrayList<>(a.getTargetStudentIds()));
        }
    }

    /**
     * 과제 목록 항목.
     *
     * submitted·score 는 **학생이 호출할 때만** 채운다 — 목록에서 "안 한 과제"를 구분하려면
     * 필요한데, 과제마다 따로 물어보면 목록 한 번에 왕복이 과제 수만큼 늘어난다.
     * 선생님에게는 특정 학생 기준이라는 게 성립하지 않아 둘 다 null 이다.
     */
    public record AssignmentSummaryResponse(
            Long id,
            String title,
            Subject subject,
            Integer grade,
            AssignmentType type,
            AssignmentSource source,
            LocalDateTime dueAt,
            LocalDateTime publishedAt,
            LocalDateTime createdAt,
            Boolean submitted,
            Short score,
            // ↓ 선생님이 호출할 때만 채운다 (§11.2 #7). 학생에게는 학급 전체 통계가 의미 없어 null.
            Integer totalStudents,
            Integer submittedCount,
            Integer submissionRate,   // 0~100. 학생이 없으면 null (분모가 0)
            Integer averageScore,     // 채점된 제출만의 평균. 없으면 null (0점이 아니다)
            // ↓ 선생님이 목록을 학년별로 묶어 보게 채운다. 학생 목록에는 넣지 않는다(다른 대상 노출 방지).
            List<Short> targetGrades,
            List<Long> targetStudentIds
    ) {
        /** 선생님용 — 집계 없이(생성 직후 등). 제출 여부는 "나"를 전제해서 성립하지 않는다. */
        public static AssignmentSummaryResponse from(Assignment a) {
            return new AssignmentSummaryResponse(a.getId(), a.getTitle(), a.getSubject(), a.getGrade(),
                    a.getType(), a.getSource(), a.getDueAt(), a.getPublishedAt(), a.getCreatedAt(),
                    null, null, null, null, null, null,
                    new ArrayList<>(a.getTargetGrades()), new ArrayList<>(a.getTargetStudentIds()));
        }

        /** 학생용 — 제출 여부·점수만. 대상(학년·학생)은 학생에게 노출하지 않는다. */
        public static AssignmentSummaryResponse of(Assignment a, Boolean submitted, Short score) {
            return new AssignmentSummaryResponse(a.getId(), a.getTitle(), a.getSubject(), a.getGrade(),
                    a.getType(), a.getSource(), a.getDueAt(), a.getPublishedAt(), a.getCreatedAt(),
                    submitted, score, null, null, null, null, null, null);
        }

        /** 선생님용 — 카드에 붙는 학급 집계 + 목록을 학년별로 묶을 대상 학년·학생까지 채운다. */
        public static AssignmentSummaryResponse ofTeacher(Assignment a, int totalStudents,
                                                          int submittedCount,
                                                          Integer submissionRate,
                                                          Integer averageScore) {
            return new AssignmentSummaryResponse(a.getId(), a.getTitle(), a.getSubject(), a.getGrade(),
                    a.getType(), a.getSource(), a.getDueAt(), a.getPublishedAt(), a.getCreatedAt(),
                    null, null, totalStudents, submittedCount, submissionRate, averageScore,
                    new ArrayList<>(a.getTargetGrades()), new ArrayList<>(a.getTargetStudentIds()));
        }
    }
}
