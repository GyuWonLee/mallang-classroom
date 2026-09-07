package com.mallang.session.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Collection;
import java.util.Optional;
import java.util.Set;

/**
 * 출석부 — Redis만 읽고 쓴다 (ERD v1.2 부록 A).
 * 세션 귀속 키: session:{id}:team:{tid}:teachers, session:{id}:{role}:{uid}:current-team
 * 전역 키(문서 v0.7 반영 예정): presence:online:teachers, presence:teachers:in-class
 */
@Service
@RequiredArgsConstructor
public class PresenceService {

    private static final String ONLINE_TEACHERS = "presence:online:teachers";
    private static final String IN_CLASS_TEACHERS = "presence:teachers:in-class";

    private final StringRedisTemplate redis;

    private String teamTeachersKey(Long sessionId, Long teamId) {
        return "session:" + sessionId + ":team:" + teamId + ":teachers";
    }

    private String currentTeamKey(Long sessionId, String role, Long userId) {
        return "session:" + sessionId + ":" + role + ":" + userId + ":current-team";
    }

    /**
     * 선생님이 마지막으로 들어간 수업. 팀 룸을 나가도 지우지 않는다 —
     * 팀 순회(A팀 퇴장 → B팀 입장) 중간에 비어 버리면 같은 수업인지 판단할 수 없기 때문이다.
     * 세션 귀속이 아니라 선생님 귀속이라 session:{id}:* 일괄 삭제 대상이 아니다.
     */
    private String lastSessionKey(Long teacherId) {
        return "presence:teacher:" + teacherId + ":last-session";
    }

    // ── 온라인 여부 (STOMP 연결 이벤트가 갱신) ──

    /**
     * 열려 있는 STOMP 연결들. 온라인 여부를 <b>연결 수</b>로 세기 위한 키다.
     *
     * <p>TTL 을 두는 이유: 프로세스가 강제 종료되면 DISCONNECT 이벤트가 오지 않아 이 집합이
     * 영원히 남는다. 기동 시 일괄 삭제는 <b>하면 안 된다</b> — 블루-그린은 구·신 슬롯이 잠깐
     * 겹치므로, 새 슬롯이 뜨면서 지우면 아직 구 슬롯에 붙어 있는 선생님이 오프라인이 된다.
     * 하루보다 길게 잡아 정상 근무 시간에는 만료되지 않게 하고, 유령만 하루 뒤 스스로 사라지게 한다.
     */
    private static final Duration CONNS_TTL = Duration.ofHours(18);

    private String connsKey(Long teacherId) {
        return "presence:teacher:" + teacherId + ":conns";
    }

    /**
     * 선생님이 STOMP 로 접속했다.
     *
     * <p>예전에는 온라인 여부가 teacherId SET 하나였다. 그래서 선생님이 라이브 화면과 채팅
     * 인박스를 <b>두 탭으로 열었다가 하나만 닫아도 완전히 오프라인</b>이 됐다 — 남은 탭은
     * 멀쩡히 연결돼 있는데 라우팅은 그 선생님을 후보에서 뺀다. 프런트가 이 결함을 주석으로
     * 적어 두고 "소켓 여는 화면을 동시에 열지 말 것"이라는 규약으로 피해 왔다.
     *
     * <p>이제 연결 id 를 세어, <b>마지막 연결이 끊길 때만</b> 오프라인으로 내린다.
     *
     * @param connectionId STOMP 세션 id. 같은 선생님의 탭마다 다르다.
     */
    public void teacherOnline(Long teacherId, String connectionId) {
        if (connectionId != null) {
            redis.opsForSet().add(connsKey(teacherId), connectionId);
            redis.expire(connsKey(teacherId), CONNS_TTL);
        }
        redis.opsForSet().add(ONLINE_TEACHERS, String.valueOf(teacherId));
    }

    /**
     * 연결 하나가 끊겼다 — 남은 연결이 없을 때만 오프라인.
     *
     * <p>{@code connectionId} 가 없으면(이벤트에서 못 읽은 경우) 예전처럼 즉시 내린다.
     * 유령으로 남아 "온라인인데 응답 없는 선생님"이 되는 쪽이 더 나쁘기 때문이다.
     */
    public void teacherOffline(Long teacherId, String connectionId) {
        if (connectionId == null) {
            redis.delete(connsKey(teacherId));
            redis.opsForSet().remove(ONLINE_TEACHERS, String.valueOf(teacherId));
            return;
        }
        redis.opsForSet().remove(connsKey(teacherId), connectionId);
        Long remaining = redis.opsForSet().size(connsKey(teacherId));
        if (remaining == null || remaining == 0L) {
            redis.delete(connsKey(teacherId));
            redis.opsForSet().remove(ONLINE_TEACHERS, String.valueOf(teacherId));
        }
    }

    // ── 수업/팀 룸 위치 (LiveKit 웹훅이 갱신) ──

    public void teacherEnteredTeamRoom(Long sessionId, Long teamId, Long teacherId) {
        redis.opsForSet().add(teamTeachersKey(sessionId, teamId), String.valueOf(teacherId));
        redis.opsForValue().set(currentTeamKey(sessionId, "teacher", teacherId), String.valueOf(teamId));
        redis.opsForValue().set(lastSessionKey(teacherId), String.valueOf(sessionId));
        redis.opsForSet().add(IN_CLASS_TEACHERS, String.valueOf(teacherId));
    }

    /**
     * 팀 룸 퇴장. <b>지금 있다고 기록된 팀에서 나갈 때만</b> 위치를 지운다.
     *
     * <p>입장 경로는 {@code lastSessionOfTeacher} 로 순서를 이미 방어하는데 퇴장만
     * 비대칭이었다. 선생님이 A팀 → B팀으로 순회할 때 LiveKit 웹훅이 (B입장, A퇴장) 순으로
     * 도착하면, 뒤늦게 온 A퇴장이 방금 기록한 B 위치를 지우고 "수업 중"에서도 빼 버린다.
     * 그 순간 이 선생님은 어느 팀에도 없는 한가한 사람으로 보여 다른 학생이 배정된다.
     */
    public void teacherLeftTeamRoom(Long sessionId, Long teamId, Long teacherId) {
        redis.opsForSet().remove(teamTeachersKey(sessionId, teamId), String.valueOf(teacherId));

        String current = redis.opsForValue().get(currentTeamKey(sessionId, "teacher", teacherId));
        if (current != null && !current.equals(String.valueOf(teamId))) {
            return; // 이미 다른 팀으로 옮겨 갔다 — 늦게 온 퇴장 웹훅이다
        }
        redis.delete(currentTeamKey(sessionId, "teacher", teacherId));
        redis.opsForSet().remove(IN_CLASS_TEACHERS, String.valueOf(teacherId));
    }

    public void studentEnteredTeamRoom(Long sessionId, Long teamId, Long studentId) {
        redis.opsForValue().set(currentTeamKey(sessionId, "student", studentId), String.valueOf(teamId));
    }

    public void studentLeftTeamRoom(Long sessionId, Long studentId) {
        redis.delete(currentTeamKey(sessionId, "student", studentId));
    }

    // ── 라우팅용 조회 ──

    /** 라우팅 규칙 1: 학생이 있는 팀 룸의 선생님 1명 */
    public Optional<Long> teacherInStudentTeam(Long sessionId, Long studentId) {
        String teamId = redis.opsForValue().get(currentTeamKey(sessionId, "student", studentId));
        if (teamId == null) {
            return Optional.empty(); // 키 없음 = 메인 룸 체류
        }
        String teacherId = redis.opsForSet().randomMember(teamTeachersKey(sessionId, Long.valueOf(teamId)));
        return Optional.ofNullable(teacherId).map(Long::valueOf);
    }

    /**
     * 선생님이 마지막으로 들어간 수업 id. 아직 어느 팀 룸에도 들어간 적 없으면 empty.
     * 배정 종료 판단용 — "다른 수업으로 넘어갔는가"를 이 값과 비교해 가린다 (S15P11A407-132).
     */
    public Optional<Long> lastSessionOfTeacher(Long teacherId) {
        return Optional.ofNullable(redis.opsForValue().get(lastSessionKey(teacherId)))
                .map(Long::valueOf);
    }

    /**
     * 라우팅 규칙 2: 온라인이면서 어느 팀 룸에도 없는 선생님 1명.
     *
     * <p><b>후보를 학급 선생님으로 제한한다.</b> 근거가 되는 SET 두 개에는 학급·세션 접두어가
     * 없고 {@code WebSocketEventListener} 가 STOMP 접속만으로 채워 넣으므로, 예전에는
     * <b>다른 반 담임이 로그인만 해 둬도 후보</b>였다. QA 중 팀원 여러 명이 각자 교사로
     * 로그인하는 지금이 정확히 그 조건이고, 그때 A반 아이가 쓴 질문 원문이 B반 담임에게 가고
     * 정작 A반 담임 화면에는 뜨지 않았다.
     *
     * <p>후보가 비면 {@code Optional.empty()} — 호출부는 대기열로 보낸다. 이는 "지금 응답
     * 가능한 선생님이 없다"는 설계된 경로이므로, 남의 반 선생님에게 붙이는 것보다 낫다.
     *
     * <p>키 구조 자체를 학급 단위로 바꾸는 전면 개편은 별도 과제다(로드맵 2-19, 팀 합의 선행).
     * 여기서는 <b>후보 필터</b>만 건다 — Redis 키·대기열 의미는 그대로다.
     *
     * @param eligibleTeacherIds 이 학급의 선생님들. 비어 있으면 배정하지 않는다.
     */
    public Optional<Long> anyFreeTeacher(Collection<Long> eligibleTeacherIds) {
        if (eligibleTeacherIds == null || eligibleTeacherIds.isEmpty()) {
            return Optional.empty();
        }
        Set<String> free = redis.opsForSet().difference(ONLINE_TEACHERS, IN_CLASS_TEACHERS);
        if (free == null || free.isEmpty()) {
            return Optional.empty();
        }
        Set<String> eligible = eligibleTeacherIds.stream()
                .map(String::valueOf)
                .collect(java.util.stream.Collectors.toSet());
        return free.stream().filter(eligible::contains).findAny().map(Long::valueOf);
    }
}
