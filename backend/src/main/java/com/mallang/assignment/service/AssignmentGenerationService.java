package com.mallang.assignment.service;

import com.mallang.assignment.ai.GenerationCommand;
import com.mallang.assignment.ai.ResolvedMaterial;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.dto.AssignmentDtos.GenerateAccepted;
import com.mallang.assignment.dto.AssignmentDtos.GenerateRequest;
import com.mallang.assignment.material.MaterialSource;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * AI 과제 생성 오케스트레이션 — 요청 검증 후 비동기 작업을 띄우고 jobId를 즉시 반환한다.
 * 커리큘럼 이탈 방지를 위해 결과는 항상 '초안'으로만 남고, 선생님 검수 후 별도 확정 저장한다 (명세 §7).
 */
@Service
@RequiredArgsConstructor
public class AssignmentGenerationService {

    private final AssignmentAccessGuard accessGuard;
    private final MaterialSource materialSource;
    private final GenerationJobStore jobStore;
    private final GenerationJobRunner runner;

    public GenerateAccepted startGeneration(AuthUser authUser, Long classroomId, GenerateRequest request) {
        accessGuard.requireManager(classroomId, authUser.id());
        // 받아쓰기는 국어·영어에서만 (다른 과목엔 '듣고 받아쓰기'가 성립하지 않는다).
        if (request.type() == AssignmentType.DICTATION
                && request.subject() != Subject.KOREAN && request.subject() != Subject.ENGLISH) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "dictation-subject-not-allowed",
                    "받아쓰기는 국어·영어 과목에서만 만들 수 있습니다.");
        }
        // 자료 검증(전부 READY여야 함)은 동기로 수행해 잘못된 요청은 즉시 409로 돌려준다 (명세 §7·부록 B-9).
        List<ResolvedMaterial> materials = materialSource.resolve(classroomId, request.materialIds());

        String jobId = "gen-" + UUID.randomUUID();
        GenerationCommand command = new GenerationCommand(
                request.subject(), request.type(), request.grade(), request.count(), materials);

        GenerationJob job = GenerationJob.queued(jobId, classroomId, authUser.id());
        jobStore.save(job);
        runner.run(job, command); // @Async — 즉시 반환

        return new GenerateAccepted(jobId);
    }

    public GenerationJob getJob(AuthUser authUser, String jobId) {
        GenerationJob job = jobStore.find(jobId)
                .orElseThrow(() -> new ApiException(HttpStatus.GONE, "generation-job-expired",
                        "생성 작업을 찾을 수 없습니다(만료됨). 다시 생성해 주세요."));
        // 작성자 본인이거나, 해당 학급의 관리자만 조회 가능
        if (!job.requestedBy().equals(authUser.id())) {
            accessGuard.requireManager(job.classroomId(), authUser.id());
        }
        return job;
    }
}
