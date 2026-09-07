package com.mallang.report.dto;

import com.mallang.assignment.entity.AssignmentType;

import java.util.List;
import java.util.Map;

/** 학습 리포트 DTO (명세 §8). 수치는 SQL/집계로, 코멘트만 LLM(숫자 금지). */
public class ReportDtos {

    public record TagStat(String tag, int correct, int total, int accuracy) {
    }

    /**
     * 오답 클리닉 생성 요청 — 전부 선택(기본 객관식 5문항).
     * materialIds 를 주면 그 업로드 자료로, 비우면 학생 학년의 내장 어휘자료로 grounding.
     */
    public record ClinicRequest(AssignmentType type, Integer count, List<String> materialIds) {
    }

    /**
     * 학생 상세 이해도 + 리포트.
     * 앞 4개 필드(studentId·overall·byType·recommendedLevel)는 프론트 types/learning.ts 의
     * Understanding 계약과 이름·의미가 정확히 일치한다 → learningApi.getUnderstanding()가 그대로 동작.
     * 나머지는 리포트 상세(강약점·추천 활동)로, 계약을 확장하는 추가 필드다.
     */
    public record ReportResponse(
            Long studentId,
            int overall,                    // 종합 정답률 0~100 (Understanding.overall)
            Map<String, Integer> byType,    // 과제 유형별 정답률 (Understanding.byType) — 예: {"MULTIPLE_CHOICE":40}
            Integer recommendedLevel,       // 실력 맞춤 추천 난이도 1~5 (1 아주 쉬움 … 5 심화, Understanding.recommendedLevel, 이슈 76)
            int gradedAssignments,          // 채점된(최신 시도) 과제 수
            List<TagStat> tagStats,         // 개념태그별 정답률 (약점 우선 정렬)
            List<String> strengths,         // 잘한 개념
            List<String> weaknesses,        // 부족한 개념
            String comment,                 // 격려·조언 (LLM 또는 템플릿)
            String levelReason,             // 그 난이도를 추천한 이유 (숫자 없이 한 문장)
            List<String> recommendedActivities  // '추천 활동' — 약점 기반 학습 제안 (버튼이 이 아래에 붙음)
    ) {
    }
}
