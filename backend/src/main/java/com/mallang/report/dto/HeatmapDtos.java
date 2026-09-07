package com.mallang.report.dto;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 학급 히트맵 · 과제별 제출 현황 DTO (명세 §8).
 *
 * 측정 대원칙: 숫자는 통계가, 해석은 LLM이. 여기 담기는 값은 전부 SQL/집계 결과이며
 * 단일 "이해도 점수"는 만들지 않는다 — 서열화를 피하려는 팀 확정 사항이다.
 * 모든 정답률에 표본 수(n)와 반평균(classAvg)을 병기해, 개인 약점과 학급 공통 이슈를 구분한다.
 */
public class HeatmapDtos {

    /** 신호등 밴드. 표본이 적으면 밴드를 매기지 않는다(저학년 찍기 노이즈 차단) */
    public enum Band {
        GOOD, WARN, RISK, INSUFFICIENT;

        /** 태그당 채점 문항이 이 수보다 적으면 INSUFFICIENT (명세 §8) */
        public static final int MIN_SAMPLE = 3;

        public static Band of(int accuracy, int sampleCount) {
            if (sampleCount < MIN_SAMPLE) {
                return INSUFFICIENT;
            }
            if (accuracy >= 80) {
                return GOOD;
            }
            return accuracy >= 60 ? WARN : RISK;
        }
    }

    /** 히트맵의 한 칸 — 학생 한 명의 한 태그 */
    public record HeatmapCell(String tag, Integer accuracy, int n, String band) {}

    public record HeatmapRow(Long studentId, String name, Short grade, List<HeatmapCell> cells) {}

    /** 태그별 반평균 — 개인 약점(45% vs 반평균 72%)과 학급 공통 이슈(45% vs 48%)를 구분하는 기준 */
    public record TagAverage(String tag, Integer accuracy, int n, String band) {}

    /**
     * 학급 히트맵 — 학생 × 태그 매트릭스. tags 순서가 각 row 의 cells 순서와 같아
     * 프론트가 그대로 표로 그릴 수 있다.
     */
    public record ClassHeatmapResponse(
            Long classroomId,
            List<String> tags,
            List<TagAverage> classAverages,
            List<HeatmapRow> students
    ) {}

    /** 과제별 제출 한 건 — 같은 학생의 재제출은 최신 시도만 담는다 */
    public record SubmissionSummary(
            Long studentId,
            String name,
            Short score,
            int attemptNo,
            LocalDateTime submittedAt
    ) {}

    /**
     * 문항별 통계. choiceDistribution 은 선택형에서 "어떤 오답을 골랐나" — 집계만 하고
     * 의미 해석("소리 나는 대로 적음")은 LLM 몫이다. 받아쓰기 등 선택형이 아니면 비어 있다.
     */
    public record ProblemStat(
            int no,
            List<String> conceptTags,
            Integer accuracy,
            int n,
            String band,
            List<ChoiceCount> choiceDistribution
    ) {}

    public record ChoiceCount(String answer, int count) {}

    /**
     * 과제별 제출 현황 — 미제출자 파악(submittedCount vs totalStudents)과
     * 재수업 대상 문항 찾기(problems 의 낮은 accuracy)가 이 응답의 목적이다.
     */
    public record AssignmentSubmissionsResponse(
            Long assignmentId,
            String title,
            int totalStudents,
            int submittedCount,
            List<SubmissionSummary> submissions,
            List<Long> notSubmittedStudentIds,
            List<ProblemStat> problems
    ) {}
}
