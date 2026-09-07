package com.mallang.session.repository;

import java.time.LocalDateTime;

/**
 * 수업 이력 한 줄 — 목록·피드·출석이 실제로 쓰는 칸만.
 *
 * <p>엔티티로 읽지 않는 이유는 {@code board_snapshot} 이다. 칠판 스냅샷은 수업이 끝날 때
 * 저장되는 {@code jsonb} 로, 필기가 많은 수업이면 한 건이 수백 KB 다. 그런데 목록·활동 피드·
 * 출석 계산 어디에도 그 값을 읽는 코드가 없다 — 상세 화면에서 한 건씩 열 때만 쓴다.
 *
 * <p>그래서 학급 이력을 부를 때마다 <b>학기 전체 수업의 칠판 필기가 통째로</b> DB 에서 앱으로
 * 흘러왔다. 게다가 세 곳이 각자 같은 조회를 하므로 한 화면에서 여러 번 반복된다. 이 투영은
 * 그 컬럼을 SELECT 목록에서 뺀다.
 */
public record SessionHistoryView(
        Long sessionId,
        Long classroomId,
        String startedByName,
        LocalDateTime startedAt,
        LocalDateTime endedAt) {

    public boolean live() {
        return endedAt == null;
    }
}
