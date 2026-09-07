package com.mallang.report.service;

import com.mallang.assignment.ai.AiProperties;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.report.dto.ReportDtos.TagStat;
import com.mallang.report.service.ReportService.Aggregation;
import com.mallang.report.service.ReportService.Recommendation;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.ReportRowView;
import com.mallang.submission.service.GradingService;
import com.mallang.submission.service.GradingService.GradeResult;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 제출 데이터·DB·키 없이 "리포트 + 오답 클리닉 타깃"이 어떻게 나오는지 보는 데모.
 * 샘플 과제 2개에 학생 답 → 실제 GradingService로 채점 → ReportService로 집계 → 출력.
 *
 * 실행: .\gradlew.bat test --tests "*ReportDemoTest" --info
 */
class ReportDemoTest {

    private final ObjectMapper om = JsonMapper.builder().build();
    private final GradingService grading = new GradingService(om);

    @Test
    void showReportAndClinicTargets() {
        // 과제1(객관식): 받침규칙·조사 을/를 틀림, 맞춤법 맞음
        GradeResult g1 = grading.grade(om.readTree("""
                {"problems":[
                  {"no":1,"answer":0,"conceptTags":["맞춤법"]},
                  {"no":2,"answer":2,"conceptTags":["받침규칙"]},
                  {"no":3,"answer":1,"conceptTags":["조사 을/를"]}
                ]}"""), om.readTree("{\"1\":0,\"2\":0,\"3\":3}"), AssignmentType.MULTIPLE_CHOICE);

        // 과제2(객관식): 받침규칙 또 틀림, 조사 에/에게 맞음
        GradeResult g2 = grading.grade(om.readTree("""
                {"problems":[
                  {"no":1,"answer":1,"conceptTags":["받침규칙"]},
                  {"no":2,"answer":0,"conceptTags":["조사 에/에게"]}
                ]}"""), om.readTree("{\"1\":0,\"2\":0}"), AssignmentType.MULTIPLE_CHOICE);

        ReportRowView s1 = submission(1L, g1);
        ReportRowView s2 = submission(2L, g2);
        SubmissionRepository repo = mock(SubmissionRepository.class);
        when(repo.findReportRows(10L, 20L)).thenReturn(List.of(s1, s2));

        // 키 없음 → 템플릿 코멘트. LLM 을 안 타므로 캐시도 지나가지 않는다
        ReportInsightService insight = new ReportInsightService(
                new AiProperties("stub", null, null, null, null), om, mock(ReportCommentCache.class));
        ReportService reportService = new ReportService(
                repo, mock(AssignmentAccessGuard.class), insight, om);

        Aggregation agg = reportService.aggregate(10L, 20L);
        int overall = agg.overallTotal() == 0 ? 0
                : agg.overallCorrect() * 100 / agg.overallTotal();

        System.out.println("\n===== 학습 리포트 =====");
        System.out.println("[프론트 Understanding 계약] overall=" + overall
                + ", byType=" + agg.byType());
        System.out.printf("전체 정답률: %d%% (%d/%d), 채점 과제 %d개%n",
                overall, agg.overallCorrect(), agg.overallTotal(), agg.gradedAssignments());
        System.out.println("--- 개념별 정답률 (약점 우선) ---");
        for (TagStat t : agg.tagStats()) {
            System.out.printf("  %-12s %d/%d (%d%%)%n", t.tag(), t.correct(), t.total(), t.accuracy());
        }
        System.out.println("잘한 개념: " + agg.strengths());
        System.out.println("부족한 개념: " + agg.weaknesses());
        System.out.println("코멘트: " + insight.comment(agg.strengths(), agg.weaknesses()));

        ReportService.Recommendation rec = reportService.recommend(agg);
        String[] labels = {"", "아주 쉬움", "쉬움", "보통", "도전", "심화"}; // 1~5
        System.out.println("--- 실력 맞춤 추천 (이슈 76) ---");
        System.out.printf("추천 난이도(표시용): level %d/5 (%s)%n", rec.level(), labels[rec.level()]);
        System.out.println("사유: " + rec.reason());
        System.out.println("추천 활동:");
        rec.activities().forEach(a -> System.out.println("  - " + a));
        System.out.println("\n>> '맞춤 과제로 생성하기'를 누르면 이 약점 " + agg.weaknesses()
                + " + 생성 난이도 " + rec.generationLevel() + "/3 (표시 " + rec.level()
                + "/5) 로 추가 문제를 생성합니다.");
        System.out.println("=======================\n");
    }

    /**
     * 정답률에 따라 추천 난이도(1~5)가 어떻게 바뀌는지 보는 데모.
     * 실행: .\gradlew.bat test --tests "*ReportDemoTest.showRecommendedLevelScale" --info
     */
    @Test
    void showRecommendedLevelScale() {
        ReportService reportService = new ReportService(
                mock(SubmissionRepository.class), mock(AssignmentAccessGuard.class),
                mock(ReportInsightService.class), om);
        String[] labels = {"", "아주 쉬움", "쉬움", "보통", "도전", "심화"}; // 1~5

        System.out.println("\n===== 정답률 → 추천 난이도(1~5) =====");
        // 표본 부족(문항 2개 < 3) → 보통(3)으로 보류
        Recommendation few = reportService.recommend(agg(1, 2));
        System.out.printf("  문제 2개만 풂 (표본 부족)   → level %d/5 (%s) : %s%n",
                few.level(), labels[few.level()], few.reason());
        // 100문항 중 정답 수를 바꿔가며
        for (int correct : new int[]{10, 30, 50, 70, 90, 100}) {
            Recommendation rec = reportService.recommend(agg(correct, 100));
            System.out.printf("  정답률 %3d%%              → level %d/5 (%s), 생성난이도 %d/3 : %s%n",
                    correct, rec.level(), labels[rec.level()], rec.generationLevel(), rec.reason());
        }
        System.out.println("====================================\n");
    }

    // 태그·강약점은 비우고 correct/total 만 채운 집계 (추천 로직만 보기 위함)
    private Aggregation agg(int correct, int total) {
        return new Aggregation(List.of(), List.of(), List.of("받침규칙"), 1, correct, total, Map.of());
    }

    private ReportRowView submission(long assignmentId, GradeResult grade) {
        ReportRowView row = mock(ReportRowView.class);
        when(row.getAssignmentId()).thenReturn(assignmentId);
        when(row.getType()).thenReturn(AssignmentType.MULTIPLE_CHOICE); // byType 집계용
        when(row.getResults()).thenReturn(om.writeValueAsString(grade.results()));
        return row;
    }
}
