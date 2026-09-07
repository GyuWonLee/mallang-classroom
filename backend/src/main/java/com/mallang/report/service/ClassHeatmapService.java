package com.mallang.report.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.HeatmapDtos.Band;
import com.mallang.report.dto.HeatmapDtos.ClassHeatmapResponse;
import com.mallang.report.dto.HeatmapDtos.HeatmapCell;
import com.mallang.report.dto.HeatmapDtos.HeatmapRow;
import com.mallang.report.dto.HeatmapDtos.TagAverage;
import com.mallang.submission.entity.Submission;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.user.entity.User;
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
import java.util.TreeSet;

/**
 * 학급 히트맵 (명세 §8) — "수업 전 30초 만에 오늘 누굴 챙길지" 화면.
 *
 * 학생 × 개념태그 매트릭스를 만들고 각 칸에 신호등 밴드를 매긴다. 단일 이해도 점수는 만들지 않는다.
 * 통계는 조회 시 실시간 집계 — 학급 20~30명 규모라 배치가 필요 없다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ClassHeatmapService {

    private final SubmissionRepository submissionRepository;
    private final AssignmentAccessGuard accessGuard;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public ClassHeatmapResponse heatmap(AuthUser viewer, Long classroomId) {
        requireTeacher(viewer, classroomId);

        // 같은 과제를 여러 번 제출했으면 최신 시도만 본다 — 재시도로 표본이 부풀지 않게,
        // 그리고 "지금 이해 상태"를 보여주는 화면이므로
        Map<Long, Map<Long, Submission>> latestByStudent = new LinkedHashMap<>();
        Map<Long, User> students = new LinkedHashMap<>();
        for (Submission submission : submissionRepository.findByClassroomId(classroomId)) {
            User student = submission.getStudent();
            students.putIfAbsent(student.getId(), student);
            latestByStudent
                    .computeIfAbsent(student.getId(), key -> new LinkedHashMap<>())
                    .put(submission.getAssignment().getId(), submission); // 오름차순이라 뒤가 최신
        }

        Map<Long, Map<String, Tally>> perStudent = new LinkedHashMap<>();
        Map<String, Tally> classTally = new LinkedHashMap<>();
        for (Map.Entry<Long, Map<Long, Submission>> entry : latestByStudent.entrySet()) {
            Map<String, Tally> tags = perStudent.computeIfAbsent(entry.getKey(),
                    key -> new LinkedHashMap<>());
            for (Submission submission : entry.getValue().values()) {
                accumulate(submission, tags, classTally);
            }
        }

        List<String> tags = new ArrayList<>(new TreeSet<>(classTally.keySet()));
        List<TagAverage> averages = tags.stream()
                .map(tag -> {
                    Tally tally = classTally.get(tag);
                    return new TagAverage(tag, tally.accuracy(), tally.total,
                            Band.of(tally.accuracyOrZero(), tally.total).name());
                })
                .toList();

        List<HeatmapRow> rows = students.values().stream()
                .sorted(Comparator.comparing(User::getName, Comparator.nullsLast(String::compareTo)))
                .map(student -> row(student, tags, perStudent.get(student.getId())))
                .toList();

        return new ClassHeatmapResponse(classroomId, tags, averages, rows);
    }

    private HeatmapRow row(User student, List<String> tags, Map<String, Tally> tally) {
        List<HeatmapCell> cells = tags.stream()
                .map(tag -> {
                    Tally t = tally == null ? null : tally.get(tag);
                    if (t == null || t.total == 0) {
                        // 그 태그 문항을 아직 안 풀었다 — 0% 가 아니라 데이터 부족이다
                        return new HeatmapCell(tag, null, 0, Band.INSUFFICIENT.name());
                    }
                    return new HeatmapCell(tag, t.accuracy(), t.total,
                            Band.of(t.accuracyOrZero(), t.total).name());
                })
                .toList();
        return new HeatmapRow(student.getId(), student.getName(), student.getGrade(), cells);
    }

    /** 제출의 results(문항별 정오 + conceptTags)를 학생별·학급 전체 집계에 더한다 */
    private void accumulate(Submission submission, Map<String, Tally> studentTags,
                            Map<String, Tally> classTags) {
        JsonNode results = readResults(submission.getResults());
        for (JsonNode result : results) {
            boolean correct = result.path("correct").asBoolean(false);
            for (JsonNode tagNode : result.path("conceptTags")) {
                String tag = tagNode.asString("").strip();
                if (tag.isEmpty()) {
                    continue;
                }
                studentTags.computeIfAbsent(tag, key -> new Tally()).add(correct);
                classTags.computeIfAbsent(tag, key -> new Tally()).add(correct);
            }
        }
    }

    private JsonNode readResults(String json) {
        if (json == null || json.isBlank()) {
            return objectMapper.createArrayNode();
        }
        try {
            return objectMapper.readTree(json);
        } catch (JacksonException e) {
            // 깨진 제출 하나가 반 전체 히트맵을 막지 않게 건너뛴다
            log.warn("제출 results 파싱 실패 — 집계에서 제외", e);
            return objectMapper.createArrayNode();
        }
    }

    private void requireTeacher(AuthUser viewer, Long classroomId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, viewer.id());
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "manager-only",
                    "학급 히트맵은 선생님만 볼 수 있습니다.");
        }
    }

    /** 정오 카운터 — 정답률은 정수 %로 반올림 */
    static final class Tally {
        private int correct;
        private int total;

        void add(boolean isCorrect) {
            total++;
            if (isCorrect) {
                correct++;
            }
        }

        Integer accuracy() {
            return total == 0 ? null : accuracyOrZero();
        }

        int accuracyOrZero() {
            return total == 0 ? 0 : (int) Math.round(correct * 100.0 / total);
        }

        int total() {
            return total;
        }
    }
}
