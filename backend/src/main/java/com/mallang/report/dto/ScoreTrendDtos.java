package com.mallang.report.dto;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;

import java.time.LocalDateTime;
import java.util.List;

/** 학생별 과제 점수 추이 (명세 §11.4 — 선생님이 보는 제출 이력). */
public class ScoreTrendDtos {

    /** 과제 하나에 대한 그 학생의 최신 시도. */
    public record ScoreTrendPoint(
            Long assignmentId,
            String assignmentTitle,
            Subject subject,
            AssignmentType type,
            Short score,          // 수동 채점 유형은 null (제출한 것은 사실)
            int attemptNo,
            LocalDateTime submittedAt
    ) {
    }

    /**
     * 제출이 오래된 것부터 온다 — 화면의 추이선이 왼쪽에서 오른쪽으로 읽히도록.
     * averageScore 는 채점된 제출만의 평균이고, 채점된 게 없으면 null 이다(0점이 아니다).
     */
    public record ScoreTrendResponse(
            Long studentId,
            Integer averageScore,
            List<ScoreTrendPoint> submissions
    ) {
    }
}
