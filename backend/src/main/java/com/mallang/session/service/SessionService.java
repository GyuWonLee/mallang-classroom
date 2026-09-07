package com.mallang.session.service;

import com.mallang.chat.service.ChatRouterService;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.SessionStartNotifier;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.dto.SessionDtos.SessionDetailResponse;
import com.mallang.session.dto.SessionDtos.SessionParticipantResponse;
import com.mallang.session.dto.SessionDtos.SessionStateResponse;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionHistoryView;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
public class SessionService {

    private final LiveSessionRepository liveSessionRepository;
    private final SessionParticipantRepository sessionParticipantRepository;
    private final ClassroomMemberRepository classroomMemberRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final UserRepository userRepository;
    private final ChatRouterService chatRouterService;
    private final SessionStartNotifier sessionStartNotifier;
    private final SimpMessagingTemplate messagingTemplate;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final LiveKitRoomService liveKitRoomService;
    private final SessionTopicService sessionTopicService;

    private static final Pattern TEAM_TEACHERS_KEY = Pattern.compile("session:\\d+:team:(\\d+):teachers");

    /** 수업 시작 — 학급당 진행중 1개 (동시 시작 경합은 DB 부분 유니크 인덱스가 최종 방어) */
    @Transactional
    /**
     * 수업 시작. {@code grade} 를 주면 <b>그 학년의 수업</b>이고, 같은 학급의 다른 학년 수업과
     * 나란히 돌아간다 — 복식학급에서 1학년은 A 선생님, 3학년은 B 선생님이 동시에 진행하려는 것이다.
     *
     * <p>겹침 판정은 학년으로 한다. 다만 <b>학년 없는 수업(= 학급 전체)</b>은 어느 쪽과도 겹친다:
     * 이미 열려 있으면 새 학년 수업을 막고, 반대로 학년 수업이 하나라도 열려 있으면 학급 전체
     * 수업을 열 수 없다. V31 이전에 만들어진 수업이 이 자리에 해당한다.</p>
     *
     * <p>동시 요청 두 건이 같은 순간 이 검사를 통과하는 경합은 코드로 막지 못한다 — 그때는
     * DB 의 부분 유니크 인덱스({@code ux_live_session_open_per_grade})가 뒤에서 걸러 낸다.</p>
     */
    public LiveSession start(Long classroomId, Short grade, AuthUser authUser) {
        ClassroomMember member = requireManager(classroomId, authUser);
        if (grade != null && !member.getClassroom().getGrades().contains(grade)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "grade-not-in-classroom",
                    "이 학급이 맡지 않는 학년입니다");
        }
        for (LiveSession open : liveSessionRepository
                .findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(classroomId)) {
            if (open.getGrade() == null || grade == null || open.getGrade().equals(grade)) {
                throw new ApiException(HttpStatus.CONFLICT, "session-already-open",
                        "이미 진행 중인 수업이 있습니다");
            }
        }
        LiveSession session = liveSessionRepository.save(LiveSession.start(
                member.getClassroom(), userRepository.getReferenceById(authUser.id()), grade));
        sessionStartNotifier.notifyStarted(classroomId, session.getId(), authUser.id());
        return session;
    }

    /**
     * 수업 종료 — 순서가 중요하다:
     * ① ended_at 기록(신규 발행 차단) + 출석 행 마감 → ② 교사 배정 종료 → ③ 대기열 정리
     * → ④ Redis 일괄 삭제 → ⑤ 종료 방송 → ⑥ LiveKit 룸 삭제
     * ①이 먼저여야 종료 직후 웹훅(drainWaitingQueue)이 죽은 수업의 학생을 배정하는 꼬임을 막는다.
     */
    @Transactional
    public void end(Long sessionId, AuthUser authUser) {
        LiveSession session = liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-open",
                        "진행 중인 수업이 아닙니다"));
        requireMember(session.getClassroom().getId(), authUser);
        requireSessionTeacher(session, authUser);
        closeSession(session);

        // ⑥ LiveKit 룸 삭제 — 접속 중인 참가자 퇴장 (명세 §5). 실패해도 종료는 유지(best-effort)
        liveKitRoomService.deleteSessionRooms(sessionId);
    }

    /**
     * LiveKit 메인 룸이 닫혀서 수업이 끝난 경우 — 모두 퇴장하고 empty_timeout(기본 5분)이
     * 지나면 LiveKit 이 room_finished 웹훅을 보낸다.
     *
     * <p>선생님이 "수업 종료"를 누르지 않고 브라우저만 닫으면 지금까지 수업이 영원히
     * 열린 채로 남았다. 이 경로가 그 구멍을 막는다.
     *
     * <p>이미 종료됐거나 없는 수업이면 아무것도 하지 않는다 — 웹훅은 재전송될 수 있다.
     * 룸 삭제(⑥)는 하지 않는다. 룸이 이미 닫혔기에 이 이벤트가 온 것이다.
     */
    @Transactional
    public void endByRoomFinished(Long sessionId) {
        liveSessionRepository.findByIdAndEndedAtIsNull(sessionId).ifPresent(this::closeSession);
    }

    /** 종료 공통부 ①~⑤. 권한 검사와 룸 삭제는 호출자가 판단한다. */
    private void closeSession(LiveSession session) {
        Long sessionId = session.getId();
        Long classroomId = session.getClassroom().getId();

        // ① 화이트보드 최종본 박제 + 종료 기록
        List<String> strokes = redis.opsForList()
                .range(SessionRedisKeys.boardStrokes(sessionId), 0, -1);
        String snapshot = (strokes == null || strokes.isEmpty())
                ? null : "[" + String.join(",", strokes) + "]";
        session.end(snapshot);

        // ①-2 남아 있는 출석 행 마감 — 종료가 곧 퇴장이다.
        // 룸을 지우면(⑥) LiveKit 이 leave 웹훅을 보내지만 순서도 도착도 보장되지 않는다.
        // 실제로 종료된 수업에 열린 행이 남아 참가자가 영원히 "접속 중"으로 조회됐다.
        // ended_at 과 같은 시각으로 닫아 출석 시간이 수업 길이를 넘지 않게 한다.
        sessionParticipantRepository.markAllLeft(sessionId, session.getEndedAt());

        // ② 이 학급 교사들의 진행중 대화 배정 종료
        for (Long teacherId : classroomMemberRepository.findUserIdsByClassroomIdAndRoleIn(
                classroomId, List.of(ClassroomRole.OWNER, ClassroomRole.MAINTAINER))) {
            chatRouterService.endConversationsOf(teacherId);
        }

        // ③ 이 수업에서 대기 중이던 학생 정리
        chatRouterService.onSessionEnded(sessionId);

        // ④ 수업 중 순간 상태 일괄 삭제 (ERD 규칙: session:{id}:*)
        Set<String> keys = scanKeys("session:" + sessionId + ":*");
        if (!keys.isEmpty()) {
            redis.delete(keys);
        }

        // ⑤ 수업 게시판에 종료 방송 — 그 방에 있던 사람들
        messagingTemplate.convertAndSend("/sub/sessions/" + sessionId,
                StompEnvelope.of(StompEventType.SESSION_ENDED, Map.of("sessionId", sessionId)));

        /*
          ⑥ 학급 구성원의 개인 채널에도. ⑤ 는 그 방을 구독한 사람만 받는다 — 학급 화면에서
          카드만 보고 있던 동료 선생님에게는 아무것도 가지 않아, 끝난 수업이 계속 '수업중'으로
          남아 있었다. 시작 알림과 짝을 맞춘다.
        */
        sessionStartNotifier.notifyEnded(classroomId, sessionId, session.getStartedBy().getId());
    }

    /**
     * 수업 이력 — 최근 수업이 먼저. 진행 중인 수업도 목록 맨 앞에 포함된다.
     * 참여 인원은 수업 목록을 다 모은 뒤 한 번에 세어 수업당 카운트 쿼리를 만들지 않는다.
     */
    @Transactional(readOnly = true)
    public List<SessionDetailResponse> history(Long classroomId, AuthUser authUser) {
        requireMember(classroomId, authUser);

        List<SessionHistoryView> sessions = liveSessionRepository.findHistoryByClassroomId(classroomId);
        if (sessions.isEmpty()) {
            return List.of();
        }
        Map<Long, Integer> headcounts =
                headcountsOf(sessions.stream().map(SessionHistoryView::sessionId).toList());
        return sessions.stream()
                .map(session -> SessionDetailResponse.of(session,
                        headcounts.getOrDefault(session.sessionId(), 0)))
                .toList();
    }

    /**
     * 수업 상세 — state 와 달리 종료된 수업도 열린다(이력에서 지난 수업을 눌렀을 때).
     * 진행 중 수업의 실시간 상태가 필요하면 state 를 쓴다.
     */
    @Transactional(readOnly = true)
    public SessionDetailResponse detail(Long sessionId, AuthUser authUser) {
        LiveSession session = liveSessionRepository.findWithStartedByById(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-found",
                        "수업을 찾을 수 없습니다"));
        requireMember(session.getClassroom().getId(), authUser);

        return SessionDetailResponse.of(session,
                headcountsOf(List.of(sessionId)).getOrDefault(sessionId, 0));
    }

    private Map<Long, Integer> headcountsOf(List<Long> sessionIds) {
        Map<Long, Integer> headcounts = new HashMap<>();
        sessionParticipantRepository.countDistinctUsersBySessionIds(sessionIds)
                .forEach(view -> headcounts.put(view.getSessionId(), (int) view.getHeadcount()));
        return headcounts;
    }

    /** 상태 스냅샷 (명세 §5) — 접속/재접속 시 호출, 이후 STOMP 증분으로 갱신 */
    @Transactional(readOnly = true)
    public SessionStateResponse state(Long sessionId, AuthUser authUser) {
        LiveSession session = liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-open",
                        "진행 중인 수업이 아닙니다"));
        requireMember(session.getClassroom().getId(), authUser);
        requireSessionTeacherWhenTeacher(session, authUser);

        List<Long> hands = memberIds("session:" + sessionId + ":hands");
        List<Long> mutedMic = memberIds(SessionRedisKeys.mutedMic(sessionId));
        List<Long> disabledCam = memberIds(SessionRedisKeys.disabledCam(sessionId));
        List<Long> grants = memberIds(SessionRedisKeys.boardGrants(sessionId));
        boolean broadcastLocked = Boolean.TRUE.equals(
                redis.hasKey(SessionRedisKeys.broadcastLock(sessionId)));

        // 팀 룸별 선생님: session:{id}:team:{tid}:teachers 키들을 훑어 구성
        Map<Long, List<Long>> teamTeachers = new HashMap<>();
        for (String key : scanKeys("session:" + sessionId + ":team:*:teachers")) {
            Matcher matcher = TEAM_TEACHERS_KEY.matcher(key);
            if (matcher.matches()) {
                teamTeachers.put(Long.valueOf(matcher.group(1)), memberIds(key));
            }
        }

        // 칠판 획: 저장된 JSON 문자열을 객체로 되살려 순서대로
        List<Object> strokes = new ArrayList<>();
        List<String> raw = redis.opsForList()
                .range(SessionRedisKeys.boardStrokes(sessionId), 0, -1);
        if (raw != null) {
            for (String json : raw) {
                try {
                    strokes.add(objectMapper.readValue(json, Object.class));
                } catch (JacksonException e) {
                    // 깨진 획은 건너뜀 (스냅샷 전체를 실패시키지 않음)
                }
            }
        }

        Map<String, String> topics = sessionTopicService.getTopics(sessionId);

        return new SessionStateResponse(session.getId(), session.getClassroom().getId(),
                session.getStartedAt(), broadcastLocked, hands, mutedMic, disabledCam, grants,
                teamTeachers, strokes, topics);
    }

    /**
     * 참가자 명단 (명세 §5) — LiveKit 은 identity(teacher-{id}/student-{id})만 알려주므로
     * 화면에 이름·역할·팀을 붙이려면 이 표가 필요하다. 학급 구성원 전원을 반환한다
     * (실제 접속 여부는 LiveKit 참가자 목록·프레즌스로 판단).
     */
    @Transactional(readOnly = true)
    public List<SessionParticipantResponse> participants(Long sessionId, AuthUser authUser) {
        LiveSession session = liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-open",
                        "진행 중인 수업이 아닙니다"));
        Long classroomId = session.getClassroom().getId();
        requireMember(classroomId, authUser);
        requireSessionTeacherWhenTeacher(session, authUser);

        Map<Long, Long> teamByUserId = new HashMap<>();
        teamMemberRepository.findUserTeamsByClassroomId(classroomId)
                .forEach(view -> teamByUserId.put(view.getUserId(), view.getTeamId()));

        return classroomMemberRepository.findWithUserByClassroomId(classroomId).stream()
                .map(ClassroomMember::getUser)
                .map(user -> new SessionParticipantResponse(user.getId(), user.getName(),
                        user.getRole().name(), teamByUserId.get(user.getId())))
                .toList();
    }

    /** KEYS 명령은 Redis 전체를 블로킹하므로 SCAN(비블로킹 순회)으로 대체 — AI 리뷰 반영 */
    private Set<String> scanKeys(String pattern) {
        Set<String> keys = new HashSet<>();
        try (Cursor<String> cursor = redis.scan(
                ScanOptions.scanOptions().match(pattern).count(100).build())) {
            cursor.forEachRemaining(keys::add);
        }
        return keys;
    }

    private List<Long> memberIds(String setKey) {
        Set<String> members = redis.opsForSet().members(setKey);
        if (members == null) {
            return List.of();
        }
        return members.stream().map(Long::valueOf).sorted().toList();
    }

    private void requireMember(Long classroomId, AuthUser authUser) {
        classroomMemberRepository.findByClassroomIdAndUserId(classroomId, authUser.id())
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "학급 구성원이 아닙니다"));
    }

    private void requireSessionTeacherWhenTeacher(LiveSession session, AuthUser authUser) {
        if (authUser.isTeacher()) {
            requireSessionTeacher(session, authUser);
        }
    }

    private void requireSessionTeacher(LiveSession session, AuthUser authUser) {
        if (!authUser.isTeacher()
                || session.getStartedBy() == null
                || !session.getStartedBy().getId().equals(authUser.id())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-session-teacher",
                    "현재 수업을 시작한 선생님만 접근하거나 종료할 수 있습니다");
        }
    }

    private ClassroomMember requireManager(Long classroomId, AuthUser authUser) {
        ClassroomMember member = classroomMemberRepository
                .findByClassroomIdAndUserId(classroomId, authUser.id())
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "학급 구성원이 아닙니다"));
        if (!member.getRole().canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-a-manager",
                    "수업 관리 권한이 없습니다 (OWNER/MAINTAINER 전용)");
        }
        return member;
    }
}
