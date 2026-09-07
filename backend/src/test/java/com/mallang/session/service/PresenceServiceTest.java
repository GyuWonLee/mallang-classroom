package com.mallang.session.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 프레즌스(출석부) — 채팅 라우팅의 근거.
 *
 * <p>학생 질문이 어느 선생님에게 갈지를 이 값들이 정한다. 키 이름이 틀리면 라우팅이
 * 조용히 실패하고(질문이 아무에게도 안 감), 지우는 시점이 틀리면 팀 순회 중에 배정이 끊긴다
 * — 실제로 S15P11A407-132 가 그 사고였다.</p>
 */
@ExtendWith(MockitoExtension.class)
class PresenceServiceTest {

    private static final Long SESSION_ID = 10L;
    private static final Long TEAM_ID = 7L;
    private static final Long TEACHER_ID = 1L;
    private static final Long STUDENT_ID = 20L;

    @Mock StringRedisTemplate redis;
    @Mock SetOperations<String, String> setOps;
    @Mock ValueOperations<String, String> valueOps;

    private PresenceService service;

    @BeforeEach
    void setUp() {
        service = new PresenceService(redis);
        lenient().when(redis.opsForSet()).thenReturn(setOps);
        lenient().when(redis.opsForValue()).thenReturn(valueOps);
    }

    @Test
    void onlineTeachersAreTrackedGlobally() {
        service.teacherOnline(TEACHER_ID, "conn-a");
        verify(setOps).add("presence:online:teachers", "1");

        when(setOps.size("presence:teacher:1:conns")).thenReturn(0L);
        service.teacherOffline(TEACHER_ID, "conn-a");
        verify(setOps).remove("presence:online:teachers", "1");
    }

    /**
     * 선생님이 라이브 화면과 채팅 인박스를 두 탭으로 열었다가 하나만 닫은 상황.
     * 예전에는 온라인 여부가 teacherId SET 하나여서 <b>남은 탭이 멀쩡한데도</b> 오프라인이 됐다.
     */
    @Test
    void closingOneOfTwoTabsKeepsTheTeacherOnline() {
        service.teacherOnline(TEACHER_ID, "conn-a");
        service.teacherOnline(TEACHER_ID, "conn-b");
        when(setOps.size("presence:teacher:1:conns")).thenReturn(1L);

        service.teacherOffline(TEACHER_ID, "conn-a");

        verify(setOps).remove("presence:teacher:1:conns", "conn-a");
        verify(setOps, never()).remove("presence:online:teachers", "1");
    }

    @Test
    void theLastTabClosingTakesTheTeacherOffline() {
        when(setOps.size("presence:teacher:1:conns")).thenReturn(0L);

        service.teacherOffline(TEACHER_ID, "conn-b");

        verify(setOps).remove("presence:online:teachers", "1");
        verify(redis).delete("presence:teacher:1:conns");
    }

    /**
     * 연결 집합이 영원히 남지 않게 만료를 건다. 기동 시 일괄 삭제는 하지 않는다 —
     * 블루-그린은 두 슬롯이 잠깐 겹치므로, 새 슬롯이 지우면 구 슬롯에 붙어 있는 선생님이 끊긴다.
     */
    @Test
    void connectionSetExpiresSoCrashedProcessesDoNotLeaveGhosts() {
        service.teacherOnline(TEACHER_ID, "conn-a");

        verify(redis).expire("presence:teacher:1:conns", java.time.Duration.ofHours(18));
    }

    /** 이벤트에서 연결 id 를 못 읽으면 유령으로 남기느니 즉시 내린다 */
    @Test
    void anUnidentifiableDisconnectStillTakesTheTeacherOffline() {
        service.teacherOffline(TEACHER_ID, null);

        verify(redis).delete("presence:teacher:1:conns");
        verify(setOps).remove("presence:online:teachers", "1");
    }

    @Test
    void enteringATeamRoomRecordsEveryRoutingFact() {
        service.teacherEnteredTeamRoom(SESSION_ID, TEAM_ID, TEACHER_ID);

        // 팀의 선생님 명단, 그 선생님의 현재 팀, 마지막 수업, 수업중 표시 — 넷이 함께 움직인다
        verify(setOps).add("session:10:team:7:teachers", "1");
        verify(valueOps).set("session:10:teacher:1:current-team", "7");
        verify(valueOps).set("presence:teacher:1:last-session", "10");
        verify(setOps).add("presence:teachers:in-class", "1");
    }

    @Test
    void leavingATeamRoomKeepsTheLastSession() {
        when(valueOps.get("session:10:teacher:1:current-team")).thenReturn("7");

        service.teacherLeftTeamRoom(SESSION_ID, TEAM_ID, TEACHER_ID);

        verify(setOps).remove("session:10:team:7:teachers", "1");
        verify(redis).delete("session:10:teacher:1:current-team");
        verify(setOps).remove("presence:teachers:in-class", "1");
        // 마지막 수업은 지우지 않는다 — A팀 퇴장과 B팀 입장 사이에 비면
        // 같은 수업인지 판단할 수 없어 순회 중 배정이 끊긴다 (S15P11A407-132)
        verify(redis, never()).delete("presence:teacher:1:last-session");
    }

    /**
     * A팀 → B팀 순회 중 웹훅이 (B입장, A퇴장) 순으로 도착한 경우.
     * 늦게 온 A퇴장이 방금 기록한 B 위치를 지우면, 그 선생님은 어느 팀에도 없는
     * 한가한 사람으로 보여 다른 학생이 배정된다. 입장 경로는 이미 순서를 방어하는데
     * 퇴장만 비대칭이었다.
     */
    @Test
    void aLateLeaveWebhookDoesNotEraseThePositionAlreadyMovedOn() {
        when(valueOps.get("session:10:teacher:1:current-team")).thenReturn("9"); // 이미 9팀

        service.teacherLeftTeamRoom(SESSION_ID, TEAM_ID, TEACHER_ID); // 7팀 퇴장이 늦게 도착

        verify(setOps).remove("session:10:team:7:teachers", "1"); // 그 팀 명단에서는 뺀다
        verify(redis, never()).delete("session:10:teacher:1:current-team");
        verify(setOps, never()).remove("presence:teachers:in-class", "1");
    }

    @Test
    void routesToATeacherSittingInTheStudentsTeamRoom() {
        when(valueOps.get("session:10:student:20:current-team")).thenReturn("7");
        when(setOps.randomMember("session:10:team:7:teachers")).thenReturn("1");

        assertThat(service.teacherInStudentTeam(SESSION_ID, STUDENT_ID)).contains(TEACHER_ID);
    }

    @Test
    void studentInTheMainRoomHasNoTeamTeacher() {
        when(valueOps.get("session:10:student:20:current-team")).thenReturn(null);

        // 키가 없다는 건 메인 룸에 있다는 뜻 — 팀 룸 라우팅 대상이 아니다
        assertThat(service.teacherInStudentTeam(SESSION_ID, STUDENT_ID)).isEmpty();
    }

    @Test
    void emptyTeamRoomYieldsNoTeacher() {
        when(valueOps.get("session:10:student:20:current-team")).thenReturn("7");
        when(setOps.randomMember("session:10:team:7:teachers")).thenReturn(null);

        assertThat(service.teacherInStudentTeam(SESSION_ID, STUDENT_ID)).isEmpty();
    }

    @Test
    void freeTeacherIsOnlineButNotInAnyClass() {
        when(setOps.difference("presence:online:teachers", "presence:teachers:in-class"))
                .thenReturn(Set.of("3"));

        assertThat(service.anyFreeTeacher(List.of(3L))).contains(3L);
    }

    /**
     * 근거가 되는 SET 에는 학급 접두어가 없다 — 다른 반 담임이 로그인만 해 둬도 여기 들어온다.
     * 그래서 후보를 학급 선생님으로 좁힌다. 좁힌 결과 아무도 없으면 배정하지 않는다
     * (호출부가 대기열로 보낸다) — 남의 반 선생님에게 붙이는 것보다 낫다.
     */
    @Test
    void aFreeTeacherFromAnotherClassroomIsNotACandidate() {
        when(setOps.difference("presence:online:teachers", "presence:teachers:in-class"))
                .thenReturn(Set.of("3"));

        assertThat(service.anyFreeTeacher(List.of(9L))).isEmpty();
    }

    @Test
    void noEligibleTeacherMeansNoRedisLookupAtAll() {
        assertThat(service.anyFreeTeacher(List.of())).isEmpty();
    }

    @Test
    void everyTeacherBusyMeansNoFallbackTarget() {
        when(setOps.difference("presence:online:teachers", "presence:teachers:in-class"))
                .thenReturn(Set.of());

        assertThat(service.anyFreeTeacher(List.of(3L))).isEmpty();
    }

    @Test
    void nullDifferenceIsTreatedAsNobodyFree() {
        when(setOps.difference("presence:online:teachers", "presence:teachers:in-class"))
                .thenReturn(null);

        // Redis 가 null 을 돌려줄 수 있다 — 여기서 안 막으면 라우팅이 NPE 로 죽는다
        assertThat(service.anyFreeTeacher(List.of(3L))).isEmpty();
    }

    @Test
    void studentTeamRoomPositionIsTrackedAndCleared() {
        service.studentEnteredTeamRoom(SESSION_ID, TEAM_ID, STUDENT_ID);
        verify(valueOps).set("session:10:student:20:current-team", "7");

        service.studentLeftTeamRoom(SESSION_ID, STUDENT_ID);
        verify(redis).delete("session:10:student:20:current-team");
    }

    @Test
    void lastSessionIsReadableForAssignmentExpiry() {
        when(valueOps.get("presence:teacher:1:last-session")).thenReturn("10");

        assertThat(service.lastSessionOfTeacher(TEACHER_ID)).contains(SESSION_ID);
    }

    @Test
    void teacherWhoNeverEnteredATeamRoomHasNoLastSession() {
        when(valueOps.get("presence:teacher:1:last-session")).thenReturn(null);

        assertThat(service.lastSessionOfTeacher(TEACHER_ID)).isEmpty();
    }
}
