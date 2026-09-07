package com.mallang.assignment.service;

import tools.jackson.databind.JsonNode;

/**
 * AI 생성 작업 상태+초안 (Redis genjob:{jobId} 값). 확정 전 초안은 DB에 없고 여기에만 있다.
 * draft는 검수/확정 저장 시 그대로 POST 할 수 있는 과제 초안(JSON).
 */
public record GenerationJob(
        String jobId,
        JobStatus status,
        Long classroomId,
        Long requestedBy,
        JsonNode draft,   // status=DONE 일 때만 채워짐
        String error      // status=FAILED 일 때만 채워짐
) {
    public static GenerationJob queued(String jobId, Long classroomId, Long requestedBy) {
        return new GenerationJob(jobId, JobStatus.QUEUED, classroomId, requestedBy, null, null);
    }

    public GenerationJob running() {
        return new GenerationJob(jobId, JobStatus.RUNNING, classroomId, requestedBy, null, null);
    }

    public GenerationJob done(JsonNode draft) {
        return new GenerationJob(jobId, JobStatus.DONE, classroomId, requestedBy, draft, null);
    }

    public GenerationJob failed(String error) {
        return new GenerationJob(jobId, JobStatus.FAILED, classroomId, requestedBy, null, error);
    }
}
