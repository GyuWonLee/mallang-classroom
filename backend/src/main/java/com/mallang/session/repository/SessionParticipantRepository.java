package com.mallang.session.repository;

import com.mallang.session.entity.SessionParticipant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SessionParticipantRepository extends JpaRepository<SessionParticipant, Long> {

    Optional<SessionParticipant> findFirstBySessionIdAndUserIdAndLeftAtIsNullOrderByJoinedAtDesc(
            Long sessionId, Long userId);

    /**
     * 강퇴한 학생의 열린 출석 행을 닫는다. 웹훅 leave 가 오지 않을 수 있어(연결이 서버에서 끊기면
     * 클라가 정상 종료 신호를 못 보낸다) 여기서 직접 닫아야 출석 시간이 무한정 열려 있지 않다.
     * 재입장 이력이 여러 행일 수 있으므로 열린 행을 모두 닫는다.
     */
    @Modifying
    @Transactional
    @Query("update SessionParticipant p set p.leftAt = :leftAt "
            + "where p.session.id = :sessionId and p.user.id = :userId and p.leftAt is null")
    int markLeft(@Param("sessionId") Long sessionId,
                 @Param("userId") Long userId,
                 @Param("leftAt") LocalDateTime leftAt);

    /**
     * 수업이 끝날 때 남아 있는 열린 행을 모두 닫는다.
     *
     * <p>종료 시점에는 아직 룸에 붙어 있는 사람이 있고, 룸을 지우면 LiveKit 이 leave 웹훅을
     * 보내지만 그 사이 순서·유실을 보장할 수 없다. 실제로 종료된 수업에 열린 행이 남아
     * 참가자가 영원히 "접속 중"으로 조회됐다. 종료가 곧 퇴장이므로 여기서 확정한다.</p>
     */
    @Modifying
    @Transactional
    @Query("update SessionParticipant p set p.leftAt = :leftAt "
            + "where p.session.id = :sessionId and p.leftAt is null")
    int markAllLeft(@Param("sessionId") Long sessionId,
                    @Param("leftAt") LocalDateTime leftAt);

    /**
     * 수업별 참여 인원 — 여러 수업의 인원을 한 번에 센다(목록에서 수업마다 세면 N+1).
     * 재입장이 새 행으로 쌓이므로 distinct user 로 세야 사람 수가 된다.
     */
    @Query("select p.session.id as sessionId, count(distinct p.user.id) as headcount "
            + "from SessionParticipant p "
            + "where p.session.id in :sessionIds "
            + "group by p.session.id")
    List<HeadcountView> countDistinctUsersBySessionIds(
            @Param("sessionIds") Collection<Long> sessionIds);

    interface HeadcountView {
        Long getSessionId();

        long getHeadcount();
    }

    /**
     * 한 학생의 학급 내 출석 원자료 — 수업별로 접는 일은 서비스가 한다.
     * p.session.id 는 FK 라 수업 테이블 조인이 생기지 않는다.
     * 재입장이 새 행이므로 한 수업에 여러 행이 나올 수 있다.
     */
    @Query("select p.session.id as sessionId, p.joinedAt as joinedAt, p.leftAt as leftAt "
            + "from SessionParticipant p "
            + "where p.session.classroom.id = :classroomId and p.user.id = :studentId "
            + "order by p.joinedAt asc")
    List<AttendanceView> findAttendanceByClassroomAndStudent(
            @Param("classroomId") Long classroomId, @Param("studentId") Long studentId);

    interface AttendanceView {
        Long getSessionId();

        LocalDateTime getJoinedAt();

        LocalDateTime getLeftAt();
    }
}