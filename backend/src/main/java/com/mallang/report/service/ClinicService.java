package com.mallang.report.service;

import com.mallang.assignment.ai.GenerationCommand;
import com.mallang.assignment.ai.ResolvedMaterial;
import com.mallang.assignment.dto.AssignmentDtos.GenerateAccepted;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.material.MaterialSource;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.assignment.service.GenerationJob;
import com.mallang.assignment.service.GenerationJobRunner;
import com.mallang.assignment.service.GenerationJobStore;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.material.repository.MaterialRepository;
import com.mallang.report.service.ReportService.Aggregation;
import com.mallang.report.service.ReportService.Recommendation;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * 오답 클리닉 — 학생의 약점 개념(리포트 집계)으로 108 AI 생성기를 태워 보강 문제 초안을 만든다.
 * 생성은 비동기(genjob) — 결과는 기존 GET /generation-jobs/{jobId} 로 폴링, 검수 후 과제로 확정.
 *
 * <p><b>grounding 자료 선택</b>: 선생님이 자료를 고르면 그걸로, 아니면 <b>학급에 올린 READY 자료</b>로
 * grounding 한다 — 약점 태그가 그 자료 안에서 초점을 잡아 '자료에서 약한 부분을 찾아' 문제를 낸다.
 * 올린 자료가 하나도 없을 때만 학년별 내장 어휘자료(builtin-korean-g{n})로 폴백한다. (자료는 학급 소속이라
 * 복식학급에서도 학년으로는 나뉘지 않는다.) 결과는 여전히 초안 → 선생님 검수 (커리큘럼 이탈 방지).
 */
@Service
@RequiredArgsConstructor
public class ClinicService {

    private static final int DEFAULT_COUNT = 5;

    private final ReportService reportService;
    private final MaterialSource materialSource;
    private final MaterialRepository materialRepository;
    private final GenerationJobStore jobStore;
    private final GenerationJobRunner runner;
    private final AssignmentAccessGuard accessGuard;
    private final UserRepository userRepository;

    public GenerateAccepted startClinic(AuthUser teacher, Long classroomId, Long studentId,
                                        AssignmentType type, Integer count, List<String> materialIds) {
        accessGuard.requireManager(classroomId, teacher.id());

        Aggregation agg = reportService.aggregate(classroomId, studentId);
        if (agg.weaknesses().isEmpty()) {
            throw new ApiException(HttpStatus.CONFLICT, "no-weak-areas",
                    "약점으로 판단된 개념이 없어 보강 문제를 만들 수 없습니다.");
        }

        User student = userRepository.findById(studentId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "student-not-found",
                        "학생을 찾을 수 없습니다."));
        if (student.getGrade() == null) {
            throw new ApiException(HttpStatus.CONFLICT, "student-grade-missing",
                    "학생 학년 정보가 없어 자료를 고를 수 없습니다.");
        }
        int grade = student.getGrade();

        // 실력 맞춤: 약점 태그 + 추천 난이도(이슈 76)로 개인화된 보강 문제를 낸다.
        Recommendation rec = reportService.recommend(agg);

        /*
          과목은 **오답이 나온 과제를 따라간다.**

          예전에는 Subject.KOREAN 이 그냥 박혀 있었다. 말랑이 국어 중심으로 시작해 다른 과목이
          없던 시절의 흔적인데, 그대로 남아 수학에서 틀려서 만든 보강 문제까지 국어로 저장됐다 —
          목록에서 과목이 거짓말을 하고, 과목별로 세는 곳마다 그 문제가 빠진다.

          채점된 제출이 아직 없으면(약점은 있는데 과목을 못 정하는 경우) 국어로 둔다.
        */
        Subject subject = reportService.weakestSubject(classroomId, studentId);
        List<String> sources = groundingSources(classroomId, grade, materialIds);
        List<ResolvedMaterial> materials = materialSource.resolve(classroomId, sources);
        GenerationCommand command = new GenerationCommand(
                subject != null ? subject : Subject.KOREAN,
                type != null ? type : AssignmentType.MULTIPLE_CHOICE,
                grade,
                count != null && count > 0 ? count : DEFAULT_COUNT,
                materials,
                agg.weaknesses(),        // ← 약점 태그 집중
                rec.generationLevel(),   // ← 실력 맞춤 난이도(표시 1~5 → 생성 1~3)
                // 범위 모드 — 자료(또는 내장 어휘)는 '범위'로만 쓰고 약점 개념으로 새 연습문제를 만든다.
                // 보강은 같은 지문 재인용이 아니라 새 문제가 필요하므로 엄격 grounding 을 푼다.
                true);

        String jobId = "gen-" + UUID.randomUUID();
        GenerationJob job = GenerationJob.queued(jobId, classroomId, teacher.id());
        jobStore.save(job);
        runner.run(job, command); // @Async

        return new GenerateAccepted(jobId);
    }

    /**
     * grounding 자료 선택. 선생님이 고른 자료가 있으면 그걸 쓰고, 아니면 학급에 올린 READY 자료로
     * grounding 한다(약점 태그가 그 안에서 초점을 잡는다). 올린 자료가 하나도 없을 때만 학년별
     * 내장 어휘자료로 폴백한다.
     */
    private List<String> groundingSources(Long classroomId, int grade, List<String> materialIds) {
        if (materialIds != null && !materialIds.isEmpty()) {
            return materialIds;
        }
        List<String> uploaded = materialRepository.findReadyTitles(classroomId).stream()
                .map(view -> String.valueOf(view.id()))
                .toList();
        return uploaded.isEmpty() ? List.of(MaterialSource.builtinKoreanId(grade)) : uploaded;
    }
}
