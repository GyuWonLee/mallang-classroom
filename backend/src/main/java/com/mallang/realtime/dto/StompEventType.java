package com.mallang.realtime.dto;

/** 명세 섹션 10의 type 목록. 문자열 오타 방지용 상수. */
public final class StompEventType {
    public static final String CHAT = "CHAT";
    public static final String CHAT_REPLY = "CHAT_REPLY";
    public static final String CHAT_WAITING = "CHAT_WAITING";
    public static final String CHAT_ASSIGNED = "CHAT_ASSIGNED";
    public static final String CHAT_ENDED = "CHAT_ENDED";
    public static final String HAND_RAISED = "HAND_RAISED";
    public static final String SESSION_STARTED = "SESSION_STARTED"; // v0.7 문서 반영 예정
    public static final String SESSION_ENDED = "SESSION_ENDED";
    public static final String BOARD_STROKE = "BOARD_STROKE";
    /** 획 하나 삭제 — 지우개. payload: { strokeId, by } */
    public static final String BOARD_STROKE_DELETED = "BOARD_STROKE_DELETED";
    public static final String BOARD_CLEAR = "BOARD_CLEAR";
    public static final String BOARD_GRANT = "BOARD_GRANT";
    /** 미디어 잠금/해제 결과 — payload: { target, action, userIds } */
    public static final String MEDIA_CONTROL = "MEDIA_CONTROL";
    /** 마이크·카메라를 켜 달라는 요청 — payload: { target, action, userIds }. 강제가 아니라 알림이다 */
    public static final String MEDIA_REQUEST = "MEDIA_REQUEST";
    /** 쉬는 시간 화면 잠금 — payload: { locked, by } */
    public static final String BROADCAST_LOCK = "BROADCAST_LOCK";
    public static final String KICKED = "KICKED";
    /** 과제 초안→공개 전환 시 학급 전원 개인 알림. payload: { classroomId, assignmentId } */
    public static final String ASSIGNMENT_PUBLISHED = "ASSIGNMENT_PUBLISHED";
    /**
     * 학급 교사 단톡방에 새 메시지. 그 학급 교사들의 개인 채널로만 간다(학생에게는 안 간다).
     * 보낸 사람은 제외한다 — REST 응답으로 이미 받았다. payload: { classroomId, message }
     */
    public static final String TEACHER_ROOM_MESSAGE = "TEACHER_ROOM_MESSAGE";
    /**
     * 1:1 쪽지가 도착했다 — 받는 사람의 개인 채널로만 간다. payload: { classroomId, message }
     *
     * <p>수업 밖에서 오가는 것이라 세션 토픽이 없다. 이게 없으면 <b>쪽지는 받은 사람이 쪽지함을
     * 직접 열기 전까지 아무 데도 나타나지 않는다.</b> 말랑이가 아이 질문을 선생님께 대신
     * 전하는 경로가 여기로 내려오는데(수업이 안 열려 있을 때), 아이에게는 "선생님 쪽지함에
     * 남겼어요"라고 말해 놓고 선생님은 알 길이 없었다.</p>
     */
    public static final String DIRECT_MESSAGE = "DIRECT_MESSAGE";

    private StompEventType() {}
}
