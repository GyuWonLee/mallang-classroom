package com.mallang.session.service;

/**
 * 세션 귀속 Redis 키 빌더 (ERD 규칙: session:{id}:* — 수업 종료 시 일괄 삭제된다).
 * 같은 키를 여러 기능이 나눠 읽고 쓰는 경우(예: 강퇴 기록 ↔ 입장 차단) 반드시 여기서 만들어 쓴다.
 */
public final class SessionRedisKeys {

    private SessionRedisKeys() {
    }

    /** 강퇴 명단 SET&lt;userId&gt; — kick 시 SADD, join 은 멤버면 403 (명세 §5 재입장 차단) */
    public static String kicked(Long sessionId) {
        return "session:" + sessionId + ":kicked";
    }

    /** 판서 권한 SET&lt;userId&gt; — grants API 가 쓰고, 획 발행(BoardController)·GET /state 가 읽는다 */
    public static String boardGrants(Long sessionId) {
        return "session:" + sessionId + ":board:grants";
    }

    /** 학생 방송 영역 쉬는 시간 잠금 — 존재하면 잠금, 해제 시 키를 삭제한다. */
    public static String broadcastLock(Long sessionId) {
        return "session:" + sessionId + ":broadcast-lock";
    }

    /** 학년별 수업 주제 HASH&lt;grade, topic&gt;. 수업 종료 시 session:{id}:* 일괄 정리 대상이다. */
    public static String topics(Long sessionId) {
        return "session:" + sessionId + ":topics";
    }

    /** 마이크 발행 잠금 SET&lt;userId&gt; — /join 제한 토큰과 웹훅 재접속 잠금의 기준이다. */
    public static String mutedMic(Long sessionId) {
        return "session:" + sessionId + ":media:muted-mic";
    }

    /** 카메라 발행 잠금 SET&lt;userId&gt; — /join 제한 토큰과 웹훅 재접속 잠금의 기준이다. */
    public static String disabledCam(Long sessionId) {
        return "session:" + sessionId + ":media:disabled-cam";
    }

    /** 칠판 획 LIST&lt;json&gt; — append 전용, 전체 지우기 시 삭제, 종료 시 board_snapshot 으로 박제 */
    public static String boardStrokes(Long sessionId) {
        return "session:" + sessionId + ":board:strokes";
    }

    /** 수업 중 한 번 사용된 strokeId SET — 개별 삭제 후 같은 ID로 획이 되살아나는 것을 막는다. */
    public static String boardStrokeIds(Long sessionId) {
        return "session:" + sessionId + ":board:stroke-ids";
    }

    /** strokeId → 직렬화된 획 HASH — 개별 조회·소유권 검사를 전체 LIST 순회 없이 처리한다. */
    public static String boardStrokeMap(Long sessionId) {
        return "session:" + sessionId + ":board:stroke-map";
    }

    /** Hash 인덱스가 기존 LIST까지 반영됐음을 나타내는 마커 — 없을 때만 한 번 재구축한다. */
    public static String boardStrokeMapReady(Long sessionId) {
        return "session:" + sessionId + ":board:stroke-map-ready";
    }

    /** 화이트보드 명령 시 DB 검증을 마친 학급 구성원 SET — 수업 종료 시 일괄 삭제된다. */
    public static String boardMembers(Long sessionId) {
        return "session:" + sessionId + ":board:members";
    }
}
