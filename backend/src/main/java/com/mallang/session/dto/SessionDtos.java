package com.mallang.session.dto;

import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.SessionHistoryView;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;
import java.util.Map;

public class SessionDtos {

    /**
     * 수업 시작 요청. {@code grade} 는 선택 — 주면 그 학년의 수업이고, 같은 학급의 다른 학년
     * 수업과 나란히 돌아간다. 비우면 예전과 같은 <b>학급 전체 수업</b>이다(그때는 그 학급에
     * 다른 수업이 하나도 없어야 한다).
     */
    public record StartSessionRequest(@Min(1) @Max(6) Short grade) {}

    /** grade 는 학급 전체 수업이면 null 이다 (V31 이전 수업 포함). */
    public record SessionResponse(Long id, Long classroomId, Short grade, LocalDateTime startedAt) {

        public static SessionResponse from(LiveSession session) {
            return new SessionResponse(session.getId(), session.getClassroom().getId(),
                    session.getGrade(), session.getStartedAt());
        }
    }

    /**
     * 수업 이력 항목 겸 수업 상세 — 목록과 상세가 같은 정보를 쓴다(상세에 더 담을 게 없다).
     * live=true 면 진행 중. 종료된 수업은 endedAt 이 채워진다.
     * participantCount 는 실제로 들어온 사람 수(재입장 중복 제거) — 학급 정원이 아니다.
     */
    public record SessionDetailResponse(
            Long sessionId,
            Long classroomId,
            String startedByName,
            LocalDateTime startedAt,
            LocalDateTime endedAt,
            boolean live,
            int participantCount) {

        public static SessionDetailResponse of(LiveSession session, int participantCount) {
            return new SessionDetailResponse(
                    session.getId(),
                    session.getClassroom().getId(),
                    session.getStartedBy().getName(),
                    session.getStartedAt(),
                    session.getEndedAt(),
                    session.getEndedAt() == null,
                    participantCount);
        }

        /** 목록 경로용 — 칠판 스냅샷을 읽지 않는 투영에서 만든다. */
        public static SessionDetailResponse of(SessionHistoryView view, int participantCount) {
            return new SessionDetailResponse(
                    view.sessionId(),
                    view.classroomId(),
                    view.startedByName(),
                    view.startedAt(),
                    view.endedAt(),
                    view.live(),
                    participantCount);
        }
    }

    public record RoomToken(String token) {
    }

    public record TeamRoomToken(String token, Long teamId) {
    }

    public record JoinResponse(String livekitUrl, RoomToken classroomRoom,
                               TeamRoomToken teamRoom, Map<String, String> topics) {
    }

    /** 학년별 수업 주제 저장 요청. 빈 문자열 또는 공백만 전달하면 해당 학년 주제를 삭제한다. */
    public record SessionTopicRequest(@NotNull @Size(max = 200) String topic) {
    }

    /**
     * 참가자 명단 — LiveKit identity(teacher-{id}/student-{id})를 사람으로 되돌리기 위한 표.
     * role 은 USER.role(TEACHER|STUDENT), teamId 는 팀 미배정이면 null.
     */
    public record SessionParticipantResponse(Long userId, String name, String role, Long teamId) {
    }

    /** 판서 권한 대상 — media-controls 와 동일 패턴 (명세 §5) */
    public enum BoardTarget { ALL, TEAM, PARTICIPANT }

    public enum BoardAction { GRANT, REVOKE }

    /** 미디어 제어 대상과 동작 (명세 §5). */
    public enum MediaTarget { ALL, TEAM, PARTICIPANT }

    public enum MediaAction {
        MUTE_MIC, UNLOCK_MIC, DISABLE_CAM, UNLOCK_CAM,
        REQUEST_UNMUTE_MIC, REQUEST_ENABLE_CAM
    }

    /**
     * 미디어 제어 요청. PARTICIPANT·TEAM·ALL 대상 마이크·카메라 잠금/해제를 지원한다.
     */
    public record MediaControlRequest(
            @NotNull MediaTarget target,
            @NotNull MediaAction action,
            Long teamId,
            Long userId
    ) {}

    /**
     * 판서 권한 부여/회수 요청. target 에 따라 teamId(TEAM) 또는 userId(PARTICIPANT) 필요.
     * 프론트 BoardGrantRequest(types/session.ts)와 동일 shape.
     */
    public record BoardGrantRequest(
            @NotNull BoardTarget target,
            @NotNull BoardAction action,
            Long teamId,
            Long userId
    ) {}

    /** 학생 방송 영역의 쉬는 시간 화면 잠금/해제 요청. */
    public record BroadcastLockRequest(@NotNull Boolean locked) {
    }

    /**
     * 접속/재접속 시 현재 상태 전체 스냅샷 (명세 §5) — 이후 STOMP 증분으로 갱신.
     * 음소거·팀 Lock은 해당 기능 구현 시 필드 추가 예정.
     */
    public record SessionStateResponse(
            Long sessionId,
            Long classroomId,
            java.time.LocalDateTime startedAt,
            boolean broadcastLocked,                             // 학생 방송 영역 쉬는 시간 잠금
            java.util.List<Long> hands,                          // 손든 학생 id
            java.util.List<Long> mutedMic,                       // 마이크 발행 잠금 학생 id
            java.util.List<Long> disabledCam,                    // 카메라 발행 잠금 학생 id
            java.util.List<Long> boardGrants,                    // 판서 권한 보유 학생 id
            java.util.Map<Long, java.util.List<Long>> teamTeachers, // 팀 룸별 선생님 id
            java.util.List<Object> boardStrokes,                 // 칠판 획 (기록된 순서)
            java.util.Map<String, String> topics) {              // 학년 문자열 -> 수업 주제
    }
}
