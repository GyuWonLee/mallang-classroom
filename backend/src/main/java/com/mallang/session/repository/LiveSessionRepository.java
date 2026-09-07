package com.mallang.session.repository;

import com.mallang.session.entity.LiveSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface LiveSessionRepository extends JpaRepository<LiveSession, Long> {

    /**
     * 한 학급에서 진행 중인 수업 <b>전부</b> — 학년마다 하나씩 열릴 수 있다(V31).
     *
     * <p>예전에는 학급당 하나라 {@code Optional} 이었다. 그 시절 시그니처를 그대로 두면
     * 두 개가 열린 순간 조용히 하나만 집어 가므로, 반환 타입을 바꿔 호출부가 전부
     * 컴파일 단계에서 드러나게 했다.</p>
     */
    List<LiveSession> findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(Long classroomId);

    Optional<LiveSession> findByIdAndEndedAtIsNull(Long id);

    /**
     * 이 선생님이 지금 진행 중인 수업들. 채팅 대기열을 풀 때 "내가 맡은 학생인가"를
     * 가리는 데 쓴다 — 학년별로 수업이 갈린 뒤로는 학급만 봐서는 판단이 안 된다.
     */
    List<LiveSession> findAllByStartedByIdAndEndedAtIsNull(Long teacherId);

    /**
     * 여러 학급의 진행 중 수업 — 학급 목록이 카드마다 "수업 중" 표시를 한다.
     * 학급마다 물어보면 왕복이 학급 수만큼 늘어난다. 한 학급에 여러 건이 올 수 있다(학년별).
     */
    @Query("select s from LiveSession s join fetch s.startedBy "
            + "where s.classroom.id in :classroomIds and s.endedAt is null")
    List<LiveSession> findOpenByClassroomIds(@Param("classroomIds") Collection<Long> classroomIds);

    /**
     * 상세 화면용 — 시작한 선생님까지 함께.
     *
     * <p>{@link #findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc} 와 결과는 같지만
     * {@code startedBy} 를 함께 가져온다. 응답이 "누가 열었는가"를 싣기 시작하면서
     * 파생 쿼리 그대로 두면 열린 수업 수만큼 추가 조회가 나간다.</p>
     */
    @Query("select s from LiveSession s join fetch s.startedBy "
            + "where s.classroom.id = :classroomId and s.endedAt is null order by s.grade asc")
    List<LiveSession> findOpenWithStarterByClassroomId(@Param("classroomId") Long classroomId);

    /**
     * 수업 이력 — 최근 수업이 먼저. 학급당 수업 수가 학기 단위로도 수십 건이라
     * 페이지네이션 없이 배열로 반환한다.
     *
     * <p>엔티티가 아니라 투영으로 읽는다 — 이유는 {@link SessionHistoryView} 참고.
     * 개설자 이름은 조인해서 함께 뽑으므로 지연 로딩 왕복도 생기지 않는다.
     */
    @Query("select new com.mallang.session.repository.SessionHistoryView("
            + "s.id, s.classroom.id, t.name, s.startedAt, s.endedAt) "
            + "from LiveSession s join s.startedBy t "
            + "where s.classroom.id = :classroomId "
            + "order by s.startedAt desc")
    List<SessionHistoryView> findHistoryByClassroomId(@Param("classroomId") Long classroomId);

    /** 상세 조회 — 종료된 수업도 열려야 하므로 endedAt 조건을 걸지 않는다. */
    @Query("select s from LiveSession s "
            + "join fetch s.startedBy "
            + "where s.id = :sessionId")
    Optional<LiveSession> findWithStartedByById(@Param("sessionId") Long sessionId);
}
