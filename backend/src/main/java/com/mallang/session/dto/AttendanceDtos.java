package com.mallang.session.dto;

import java.time.LocalDateTime;
import java.util.List;

/** 학생별 출석 (명세 §11.3 — 선생님 7 화면의 출석 막대). */
public class AttendanceDtos {

    /**
     * 수업 하나에 대한 그 학생의 출석.
     *
     * <p>재입장이 새 행으로 쌓이므로 여기서는 수업 단위로 접는다 — joinedAt 은 처음 들어온 시각,
     * leftAt 은 마지막으로 나간 시각, minutes 는 조각들의 합이다(끊겼다 들어온 사이는 빠진다).</p>
     */
    public record AttendanceEntry(
            Long sessionId,
            LocalDateTime startedAt,
            LocalDateTime endedAt,
            boolean attended,
            LocalDateTime joinedAt,   // 결석이면 null
            LocalDateTime leftAt,     // 아직 안 나갔거나 웹훅이 안 온 경우 null
            int minutes               // 총 체류 시간(분). 결석이면 0
    ) {
    }

    /**
     * 학생 한 명의 학급 전체 출석. sessions 는 최근 수업이 먼저다(수업 이력과 같은 정렬).
     * attendanceRate 는 0~100 정수 — 수업이 아직 없으면 0 (분모가 0이라 비율이 정의되지 않는다).
     */
    public record AttendanceResponse(
            Long studentId,
            int totalSessions,
            int attendedSessions,
            int attendanceRate,
            List<AttendanceEntry> sessions
    ) {
    }
}
