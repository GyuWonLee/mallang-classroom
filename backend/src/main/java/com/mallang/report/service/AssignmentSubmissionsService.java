package com.mallang.report.service;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.assignment.service.AssignmentTargetResolver;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.HeatmapDtos.AssignmentSubmissionsResponse;
import com.mallang.report.dto.HeatmapDtos.Band;
import com.mallang.report.dto.HeatmapDtos.ChoiceCount;
import com.mallang.report.dto.HeatmapDtos.ProblemStat;
import com.mallang.report.dto.HeatmapDtos.SubmissionSummary;
import com.mallang.report.service.ClassHeatmapService.Tally;
import com.mallang.submission.entity.Submission;
import com.mallang.submission.repository.SubmissionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 과제별 제출 현황 (명세 §8) — 미제출자 파악과 "반 전체가 틀린 문항"(재수업 대상) 찾기.
 *
 * 문항별 정답률은 통계로만 계산하고, 오답 분포도 집계까지만 한다 —
 * "왜 그 오답을 골랐나"의 해석은 LLM(리포트 쪽 aiAnalysis) 몫이다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AssignmentSubmissionsService {

    private final AssignmentRepository assignmentRepository;
    private final SubmissionRepository submissionRepository;
    private final ClassroomMemberRepository memberRepository;
    private final AssignmentTargetResolver targetResolver;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public AssignmentSubmissionsResponse submissions(AuthUser viewer, Long assignmentId) {
        Assignment assignment = assignmentRepository.findById(assignmentId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "assignment-not-found",
                        "과제를 찾을 수 없습니다."));
        Long classroomId = assignment.getClassroom().getId();
        requireTeacher(viewer, classroomId);

        // 같은 학생의 재제출은 최신 시도만 — 현황 화면이라 "지금 상태"를 보여준다
        Map<Long, Submission> latest = new LinkedHashMap<>();
        for (Submission submission : submissionRepository.findByAssignmentId(assignmentId)) {
            latest.merge(submission.getStudent().getId(), submission,
                    (older, newer) -> newer.getAttemptNo() >= older.getAttemptNo() ? newer : older);
        }

        List<SubmissionSummary> summaries = latest.values().stream()
                .map(s -> new SubmissionSummary(s.getStudent().getId(), s.getStudent().getName(),
                        s.getScore(), s.getAttemptNo(), s.getSubmittedAt()))
                .sorted(Comparator.comparing(SubmissionSummary::name,
                        Comparator.nullsLast(String::compareTo)))
                .toList();

        /*
          **이 과제를 받는 학생만** 센다. 학급 전체를 쓰던 때는 1학년 둘에게만 낸 과제인데
          현황에 전교생이 뜨고, 미제출 명단에 대상이 아닌 아이가 잡히고, 분모가 학급 전체라
          둘 다 낸 과제가 10% 로 보였다.
        */
        List<Long> targets = targetResolver.targets(classroomId, assignment);
        List<Long> notSubmitted = targets.stream()
                .filter(id -> !latest.containsKey(id))
                .toList();

        return new AssignmentSubmissionsResponse(assignment.getId(), assignment.getTitle(),
                targets.size(), latest.size(), summaries, notSubmitted,
                problemStats(latest.values()));
    }

    /** 문항 번호별 정답률 + 선택형 오답 분포 */
    private List<ProblemStat> problemStats(Iterable<Submission> submissions) {
        Map<Integer, Tally> tallies = new TreeMap<>();
        Map<Integer, List<String>> tagsByNo = new LinkedHashMap<>();
        Map<Integer, Map<String, Integer>> choices = new LinkedHashMap<>();

        for (Submission submission : submissions) {
            JsonNode answers = readJson(submission.getAnswers());
            for (JsonNode result : readJson(submission.getResults())) {
                int no = result.path("no").asInt(-1);
                if (no < 0) {
                    continue;
                }
                boolean correct = result.path("correct").asBoolean(false);
                tallies.computeIfAbsent(no, key -> new Tally()).add(correct);
                tagsByNo.computeIfAbsent(no, key -> tagsOf(result));

                if (!correct) {
                    // 어떤 답을 골랐는지 — 선택형이면 인덱스, 받아쓰기면 입력한 문자열
                    JsonNode chosen = answers.path(String.valueOf(no));
                    if (!chosen.isMissingNode() && !chosen.isNull()) {
                        String key = chosen.asString(chosen.toString());
                        choices.computeIfAbsent(no, k -> new LinkedHashMap<>())
                                .merge(key, 1, Integer::sum);
                    }
                }
            }
        }

        List<ProblemStat> stats = new ArrayList<>();
        tallies.forEach((no, tally) -> stats.add(new ProblemStat(
                no,
                tagsByNo.getOrDefault(no, List.of()),
                tally.accuracy(),
                tally.total(),
                Band.of(tally.accuracyOrZero(), tally.total()).name(),
                distribution(choices.get(no)))));
        return stats;
    }

    private List<ChoiceCount> distribution(Map<String, Integer> counts) {
        if (counts == null || counts.isEmpty()) {
            return List.of();
        }
        return counts.entrySet().stream()
                // 많이 고른 오답이 위로 — 재수업 때 먼저 짚을 것
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .map(e -> new ChoiceCount(e.getKey(), e.getValue()))
                .toList();
    }

    private List<String> tagsOf(JsonNode result) {
        List<String> tags = new ArrayList<>();
        for (JsonNode tag : result.path("conceptTags")) {
            String value = tag.asString("").strip();
            if (!value.isEmpty()) {
                tags.add(value);
            }
        }
        return tags;
    }

    private JsonNode readJson(String json) {
        if (json == null || json.isBlank()) {
            return objectMapper.createObjectNode();
        }
        try {
            return objectMapper.readTree(json);
        } catch (JacksonException e) {
            log.warn("제출 JSON 파싱 실패 — 집계에서 제외", e);
            return objectMapper.createObjectNode();
        }
    }

    private void requireTeacher(AuthUser viewer, Long classroomId) {
        ClassroomRole role = memberRepository.findByClassroomIdAndUserId(classroomId, viewer.id())
                .map(com.mallang.classroom.entity.ClassroomMember::getRole)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "manager-only",
                    "제출 현황은 선생님만 볼 수 있습니다.");
        }
    }
}
