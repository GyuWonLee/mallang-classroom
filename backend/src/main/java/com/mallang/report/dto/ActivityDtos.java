package com.mallang.report.dto;

import java.time.LocalDateTime;

/** 학급 활동 피드 (명세 §11.3 #10 — 선생님 4 화면의 '오늘의 활동'). */
public class ActivityDtos {

    /**
     * 피드에 뜨는 사건의 종류. 새 표를 만들지 않고 기존 데이터에서 파생하므로
     * 여기 있는 값이 곧 "어느 표에서 뽑았는지"이기도 하다.
     */
    public enum ActivityType {
        SESSION_STARTED,        // LIVE_SESSION.started_at
        SESSION_ENDED,          // LIVE_SESSION.ended_at
        ASSIGNMENT_PUBLISHED,   // ASSIGNMENT.published_at
        SUBMISSION_RECEIVED,    // SUBMISSION.submitted_at
        STUDENT_JOINED          // CLASSROOM_MEMBER.joined_at
    }

    /**
     * 피드 한 줄. targetId 는 화면에서 눌렀을 때 갈 곳(수업 id·과제 id·학생 id)이고,
     * actorName 은 "누가"에 해당한다(시스템 사건이면 null).
     */
    public record ActivityItem(
            ActivityType type,
            String title,
            String actorName,
            Long targetId,
            LocalDateTime at
    ) {
    }
}
