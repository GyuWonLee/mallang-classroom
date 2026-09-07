package com.mallang.report.service;

import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ReportDtos.ReportResponse;
import com.mallang.report.dto.ReportDtos.TagStat;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.ReportRowView;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 학습 리포트 (명세 §8). 학생의 최신 제출들을 개념태그별로 집계해 강점/약점을 도출한다.
 * 수치는 여기서 SQL/집계로 계산하고, 코멘트만 {@link ReportInsightService}(LLM/템플릿)에 맡긴다.
 *
 * <p><b>일부러 트랜잭션을 걸지 않는다.</b> 예전엔 클래스에 {@code @Transactional(readOnly = true)}
 * 가 붙어 있어서 코멘트 생성의 GMS 왕복(운영 실측 1.07~1.88초)이 읽기 트랜잭션 안에 갇혔고,
 * 그동안 커넥션 하나가 묶여 있었다. 조회는 저장소 호출 각각의 짧은 트랜잭션으로 충분하다 —
 * {@code findReportRows} 가 스칼라만 돌려주므로 지연 로딩이 없어 컨텍스트를 열어둘 이유가 없다.
 * 엔티티를 다시 끌어오는 변경을 하면 이 전제가 깨진다.</p>
 */
@Service
@RequiredArgsConstructor
public class ReportService {

    private static final int STRONG_THRESHOLD = 80; // % 이상 = 강점
    private static final int WEAK_THRESHOLD = 60;   // % 미만 = 약점

    private final SubmissionRepository submissionRepository;
    private final AssignmentAccessGuard accessGuard;
    private final ReportInsightService insightService;
    private final ObjectMapper objectMapper;

    // 실력 맞춤 추천 난이도는 표시용 5단계(1~5) — 프론트 types/learning.ts 목업 척도와 동일.
    // (생성기 프롬프트는 1~3이라 Recommendation.generationLevel()에서 압축해 넘긴다.)
    private static final int MIN_SAMPLE = 3;         // 표본 n<3이면 가운데(보통, 3)로 보류
    private static final int NEUTRAL_LEVEL = 3;      // 5단계 중 가운데

    /** 태그별 집계 결과 — 리포트와 오답클리닉(추가문제)이 공유한다. */
    public record Aggregation(List<TagStat> tagStats, List<String> strengths,
                              List<String> weaknesses, int gradedAssignments,
                              int overallCorrect, int overallTotal,
                              Map<String, Integer> byType) {
    }

    /** 실력 맞춤 추천 — 난이도(표시용 1~5)·사유·추천 활동. 리포트와 클리닉(맞춤 과제 생성)이 공유한다. */
    public record Recommendation(int level, String reason, List<String> activities) {
        /** 생성기 프롬프트 난이도(1~3)로 압축 — 표시용 5단계를 생성 척도에 매핑 (1·2→1, 3→2, 4·5→3). */
        public int generationLevel() {
            return level <= 2 ? 1 : level == 3 ? 2 : 3;
        }
    }

    public ReportResponse report(AuthUser viewer, Long classroomId, Long studentId) {
        requireAccess(viewer, classroomId, studentId);
        Aggregation agg = aggregate(classroomId, studentId);
        // 선생님 화면 — 채점 데이터가 없으면 학생 응원 대신 '선생님에게 도움되는 안내'를 준다.
        String comment = agg.overallTotal() == 0
                ? insightService.noDataAdvice()
                : insightService.comment(agg.strengths(), agg.weaknesses());
        Recommendation rec = recommend(agg);
        int overall = agg.overallTotal() == 0 ? 0
                : (int) Math.round(agg.overallCorrect() * 100.0 / agg.overallTotal());
        return new ReportResponse(studentId, overall, agg.byType(), rec.level(),
                agg.gradedAssignments(), agg.tagStats(), agg.strengths(), agg.weaknesses(),
                comment, rec.reason(), rec.activities());
    }

    /**
     * 실력에 맞는 추천 난이도(이슈 76). 최근 정답률로만 판단 — 학년 안에서의 상대 난이도라
     * 학년 값은 쓰지 않는다. 표본이 적으면(n&lt;3) 찍기 노이즈를 피해 기본 난이도로 보류한다.
     */
    public Recommendation recommend(Aggregation agg) {
        int total = agg.overallTotal();
        if (total < MIN_SAMPLE) {
            return new Recommendation(NEUTRAL_LEVEL,
                    "아직 푼 문제가 적어 보통 난이도로 시작하는 걸 추천해요.",
                    recommendedActivities(agg.weaknesses()));
        }
        int accuracy = agg.overallCorrect() * 100 / total;
        // 0~19→1, 20~39→2, 40~59→3, 60~79→4, 80~100→5 (프론트 목업 1 + overall/20 과 동일)
        int level = Math.min(5, 1 + accuracy / 20);
        return new Recommendation(level, reasonFor(level), recommendedActivities(agg.weaknesses()));
    }

    // 사유는 추천 레벨에서 바로 도출 — 라벨(1 아주 쉬움 … 5 심화)과 문구가 어긋나지 않게.
    private String reasonFor(int level) {
        return switch (level) {
            case 1 -> "지금은 기초를 다질 때예요. 가장 쉬운 난이도부터 차근차근 시작해요.";
            case 2 -> "쉬운 난이도로 자신감을 먼저 쌓는 걸 추천해요.";
            case 3 -> "지금 실력에 맞는 보통 난이도를 추천해요.";
            case 4 -> "잘하고 있어요. 조금 더 어려운 난이도에 도전해봐요.";
            default -> "아주 잘해요! 가장 높은 난이도에 도전하길 추천해요.";
        };
    }

    private List<String> recommendedActivities(List<String> weaknesses) {
        List<String> activities = new ArrayList<>();
        if (weaknesses.isEmpty()) {
            activities.add("전반적으로 잘하고 있어요 — 새로운 유형이나 한 단계 높은 난이도에 도전해봐요.");
        } else {
            weaknesses.stream().limit(3)
                    .forEach(tag -> activities.add(tag + " 개념을 다시 짚는 문제로 연습해요."));
        }
        return activities;
    }

    /** 접근 없이 집계만 (클리닉 생성이 약점 태그를 얻기 위해 재사용). 전 과목. */
    public Aggregation aggregate(Long classroomId, Long studentId) {
        return aggregate(classroomId, studentId, null);
    }

    /** 과목별 집계 — subject 가 null 이면 전 과목(통지표는 과목별로 부른다). */
    public Aggregation aggregate(Long classroomId, Long studentId, Subject subject) {
        // 과제별 최신 시도만 반영 (submittedAt 오름차순이라 마지막이 최신). subject 지정 시 그 과목만.
        Map<Long, ReportRowView> latest = new LinkedHashMap<>();
        for (ReportRowView row : submissionRepository.findReportRows(classroomId, studentId)) {
            if (subject == null || row.getSubject() == subject) {
                latest.put(row.getAssignmentId(), row);
            }
        }

        Map<String, int[]> perTag = new LinkedHashMap<>();  // tag -> [correct, total]
        Map<String, int[]> perType = new LinkedHashMap<>(); // 과제유형 -> [correct, total]
        int overallCorrect = 0;
        int overallTotal = 0;
        for (ReportRowView row : latest.values()) {
            // 과제 유형 (byType 집계용) — 런타임엔 NOT NULL, 테스트 목에선 null일 수 있어 방어
            String type = row.getType() != null ? row.getType().name() : null;
            for (JsonNode result : readResults(row.getResults())) {
                boolean correct = result.path("correct").asBoolean();
                overallTotal++;
                if (correct) {
                    overallCorrect++;
                }
                if (type != null) {
                    int[] tcnt = perType.computeIfAbsent(type, k -> new int[2]);
                    if (correct) {
                        tcnt[0]++;
                    }
                    tcnt[1]++;
                }
                for (JsonNode tag : result.path("conceptTags")) {
                    int[] cnt = perTag.computeIfAbsent(tag.asString(), k -> new int[2]);
                    if (correct) {
                        cnt[0]++;
                    }
                    cnt[1]++;
                }
            }
        }

        List<TagStat> tagStats = new ArrayList<>();
        List<String> strengths = new ArrayList<>();
        List<String> weaknesses = new ArrayList<>();
        perTag.forEach((tag, cnt) -> {
            int pct = cnt[1] == 0 ? 0 : cnt[0] * 100 / cnt[1];
            tagStats.add(new TagStat(tag, cnt[0], cnt[1], pct));
            if (pct >= STRONG_THRESHOLD) {
                strengths.add(tag);
            } else if (pct < WEAK_THRESHOLD) {
                weaknesses.add(tag);
            }
        });
        tagStats.sort(Comparator.comparingInt(TagStat::accuracy)); // 약점 우선

        Map<String, Integer> byType = new LinkedHashMap<>();
        perType.forEach((type, cnt) -> byType.put(type, cnt[1] == 0 ? 0 : cnt[0] * 100 / cnt[1]));

        return new Aggregation(tagStats, strengths, weaknesses, latest.size(),
                overallCorrect, overallTotal, byType);
    }

    // 선생님(학급 관리자) 또는 본인만 열람
    private void requireAccess(AuthUser viewer, Long classroomId, Long studentId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, viewer.id());
        if (!role.canManage() && !viewer.id().equals(studentId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "report-forbidden",
                    "본인 또는 학급 선생님만 리포트를 볼 수 있습니다.");
        }
    }

    /**
     * 이 학생이 <b>가장 많이 틀린 과목</b> — 맞춤(보강) 문제를 어느 과목으로 낼지 정하는 데 쓴다.
     *
     * <p>보강 문제는 오답에서 출발한다. 그러니 과목도 그 오답이 나온 과제를 따라가야 한다 —
     * 수학에서 틀려서 만든 보강이 국어로 저장되면, 나중에 "수학 과제 몇 개 냈지"를 세는 곳마다
     * 그 문제가 빠지고 학생 화면에서도 엉뚱한 과목 아래 놓인다.</p>
     *
     * <p>과제 수가 아니라 <b>틀린 문항 수</b>로 센다. 국어 과제 세 개를 다 맞고 수학 한 개에서
     * 열 문제를 틀렸다면 보강해야 할 것은 수학이다. 채점된 제출이 없으면 {@code null} —
     * 부를 쪽이 기본값을 정한다.</p>
     */
    public Subject weakestSubject(Long classroomId, Long studentId) {
        // 과제별 최신 시도만 (aggregate 와 같은 규칙 — submittedAt 오름차순이라 마지막이 최신)
        Map<Long, ReportRowView> latest = new LinkedHashMap<>();
        for (ReportRowView row : submissionRepository.findReportRows(classroomId, studentId)) {
            latest.put(row.getAssignmentId(), row);
        }

        Map<Subject, Integer> wrongBySubject = new LinkedHashMap<>();
        for (ReportRowView row : latest.values()) {
            Subject subject = row.getSubject();
            if (subject == null) {
                continue;
            }
            int wrong = 0;
            for (JsonNode result : readResults(row.getResults())) {
                if (!result.path("correct").asBoolean()) {
                    wrong++;
                }
            }
            if (wrong > 0) {
                wrongBySubject.merge(subject, wrong, Integer::sum);
            }
        }

        // 동점이면 먼저 만난 과목 — LinkedHashMap 이라 최신 제출 순서를 따른다
        return wrongBySubject.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(null);
    }

    private JsonNode readResults(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (JacksonException e) {
            throw new IllegalStateException("채점 결과를 해석할 수 없습니다.", e);
        }
    }
}
