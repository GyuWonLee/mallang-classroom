package com.mallang.submission.repository;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.submission.entity.Submission;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SubmissionRepository extends JpaRepository<Submission, Long> {

    // 재제출 시도 번호 계산용
    int countByAssignmentIdAndStudentId(Long assignmentId, Long studentId);

    /**
     * 내 제출 목록 — 과제를 fetch join 하지 않고 필요한 칼럼만 뽑는다.
     * 과제에는 jsonb 본문(content)이 있어 엔티티로 끌어오면 제출마다 문제 전문이 따라온다.
     * 최신 시도 선별은 서비스에서 (같은 과제 여러 시도가 다 들어온다).
     */
    @Query("select s.id as submissionId, a.id as assignmentId, a.title as title, "
            + "a.subject as subject, a.type as type, s.score as score, "
            + "s.attemptNo as attemptNo, s.submittedAt as submittedAt "
            + "from Submission s join s.assignment a "
            + "where s.student.id = :studentId "
            + "order by s.submittedAt desc")
    List<MySubmissionView> findMineByStudentId(@Param("studentId") Long studentId);

    /**
     * 과제 목록의 "제출했나·몇 점인가" 표시용. 학급 전체 과제에 대한 내 제출을 한 번에 가져와
     * 과제 수만큼 쿼리가 늘지 않게 한다. 최신 시도 선별은 서비스에서.
     */
    @Query("select s.assignment.id as assignmentId, s.score as score, s.attemptNo as attemptNo "
            + "from Submission s "
            + "where s.student.id = :studentId and s.assignment.classroom.id = :classroomId")
    List<MyScoreView> findMyScoresInClassroom(@Param("classroomId") Long classroomId,
                                             @Param("studentId") Long studentId);

    /**
     * 내 답안 상세 — 최신 시도 하나. 과제를 함께 로딩한다(제목과 content 를 바로 쓴다).
     * 호출부가 트랜잭션 밖이라(SubmissionService#mySubmission — LLM 왕복 동안 커넥션을 쥐지 않으려고)
     * 프록시를 나중에 깨울 수 없다. 한 행이라 content 를 같이 끌어와도 부담이 없고,
     * 오히려 기존의 "프록시 초기화 1회 추가" 가 사라져 쿼리가 2회 → 1회로 준다.
     */
    @EntityGraph(attributePaths = "assignment")
    Optional<Submission> findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(
            Long assignmentId, Long studentId);

    /**
     * 과제 총평 캐시 저장. 호출 지점이 트랜잭션 밖이라 더티 체킹을 쓸 수 없어
     * 한 컬럼만 직접 갱신한다. 짧은 자체 트랜잭션으로 끝나므로 LLM 왕복과 겹치지 않는다.
     */
    @Modifying
    @Transactional
    @Query("update Submission s set s.feedback = :feedback where s.id = :id")
    void updateFeedback(@Param("id") Long id, @Param("feedback") String feedback);

    interface MySubmissionView {
        Long getSubmissionId();

        Long getAssignmentId();

        String getTitle();

        Subject getSubject();

        AssignmentType getType();

        Short getScore();

        int getAttemptNo();

        LocalDateTime getSubmittedAt();
    }

    interface MyScoreView {
        Long getAssignmentId();

        Short getScore();

        int getAttemptNo();
    }

    /**
     * 선생님이 보는 학생 한 명의 제출 이력(점수 추이). 엔티티가 아니라 칼럼만 뽑는다 —
     * 과제에는 jsonb 본문(content)이 있어 엔티티로 끌어오면 제출마다 문제 전문이 따라온다.
     * 최신 시도 선별은 서비스에서 (findMineByStudentId 와 같은 방식).
     */
    @Query("select a.id as assignmentId, a.title as title, a.subject as subject, "
            + "a.type as type, s.score as score, s.attemptNo as attemptNo, "
            + "s.submittedAt as submittedAt "
            + "from Submission s join s.assignment a "
            + "where a.classroom.id = :classroomId and s.student.id = :studentId "
            + "order by s.submittedAt asc")
    List<ScoreTrendView> findScoreTrend(@Param("classroomId") Long classroomId,
                                        @Param("studentId") Long studentId);

    /**
     * 과제별 제출 인원 — 학급 목록의 진행률(분자)과 과제 목록의 제출률에 쓴다.
     * 재제출이 새 행이라 distinct 로 사람 수를 센다. 발행 과제만 세는 이유는
     * 초안이 분모에 없기 때문이다(countPublishedByClassroomIds 와 짝을 맞춘다).
     * 행 수 = 발행 과제 수라 학급이 몇 개든 한 번의 쿼리로 끝난다.
     */
    @Query("select a.classroom.id as classroomId, a.id as assignmentId, "
            + "count(distinct s.student.id) as submitters "
            + "from Submission s join s.assignment a "
            + "where a.classroom.id in :classroomIds and a.publishedAt is not null "
            + "group by a.classroom.id, a.id")
    List<AssignmentSubmitterView> countSubmittersByClassroomIds(
            @Param("classroomIds") Collection<Long> classroomIds);

    /**
     * 학급 전체 제출의 (과제·학생·점수·시도) — 과제 목록의 제출률·평균점수 집계용.
     * 최신 시도 선별을 서비스에서 하는 이유는, "과제별 최신 시도의 평균"을 JPQL 한 방으로
     * 쓰려면 윈도우 함수가 필요한데 학급이 20~30명 규모라 그만한 값이 없어서다
     * (findByClassroomId 주석의 판단과 같다). 엔티티가 아니라 칼럼만 뽑아 jsonb 를 피한다.
     */
    @Query("select s.assignment.id as assignmentId, s.student.id as studentId, "
            + "s.score as score, s.attemptNo as attemptNo "
            + "from Submission s where s.assignment.classroom.id = :classroomId")
    List<ClassroomScoreView> findClassroomScores(@Param("classroomId") Long classroomId);

    /**
     * 활동 피드용 최근 제출 — 누가 어떤 과제를 냈는지. 피드는 최근 N건만 보여주므로
     * 전부 읽지 않고 잘라 온다(제출은 학기 내내 쌓인다).
     */
    @Query(value = "select a.id as assignmentId, a.title as assignmentTitle, "
            + "u.name as studentName, s.submittedAt as submittedAt "
            + "from Submission s join s.assignment a join s.student u "
            + "where a.classroom.id = :classroomId "
            + "order by s.submittedAt desc")
    List<FeedSubmissionView> findRecentSubmissions(@Param("classroomId") Long classroomId,
                                                   org.springframework.data.domain.Limit limit);

    interface FeedSubmissionView {
        Long getAssignmentId();

        String getAssignmentTitle();

        String getStudentName();

        LocalDateTime getSubmittedAt();
    }

    interface ClassroomScoreView {
        Long getAssignmentId();

        Long getStudentId();

        Short getScore();

        int getAttemptNo();
    }

    interface AssignmentSubmitterView {
        Long getClassroomId();

        Long getAssignmentId();

        long getSubmitters();
    }

    interface ScoreTrendView {
        Long getAssignmentId();

        String getTitle();

        Subject getSubject();

        AssignmentType getType();

        Short getScore();

        int getAttemptNo();

        LocalDateTime getSubmittedAt();
    }

    /**
     * 리포트·클리닉 집계용 — 특정 학급의 특정 학생 제출 전체 (최신 시도 선별은 서비스에서).
     * 엔티티가 아니라 칼럼만 뽑는데, 이유가 둘이고 두 번째가 더 중요하다.
     *
     * <p>하나는 과제의 type 을 읽는 순간 프록시가 깨어나 jsonb 본문(content, 문제 전문)까지
     * 딸려 온다는 것.</p>
     *
     * <p>다른 하나는 <b>프록시를 깨우려면 영속성 컨텍스트가 열려 있어야 해서 호출부가 트랜잭션
     * 안에 있어야 한다</b>는 제약이 생긴다는 것이다. 그 제약 탓에 리포트의 LLM 왕복(운영 실측
     * 1.07~1.88초)이 읽기 트랜잭션 안에 갇혀 커넥션을 그만큼 붙잡고 있었다. 스칼라만 받으면
     * 제약이 사라져 집계와 LLM 호출을 떼어놓을 수 있다.</p>
     */
    @Query("select a.id as assignmentId, a.type as type, a.subject as subject, s.results as results "
            + "from Submission s join s.assignment a "
            + "where s.student.id = :studentId and a.classroom.id = :classroomId "
            + "order by s.submittedAt asc")
    List<ReportRowView> findReportRows(@Param("classroomId") Long classroomId,
                                       @Param("studentId") Long studentId);

    interface ReportRowView {
        Long getAssignmentId();

        AssignmentType getType();

        Subject getSubject();

        String getResults();
    }

    /**
     * 과제별 제출 현황 — 제출자 이름을 함께 표시하므로 학생을 fetch join 한다.
     * 파생 쿼리로 두면 이름 접근이 학생 프록시를 깨워 조회가 한 번 더 나간다(측정: 1 → 2회).
     * s.assignment.id 는 submission 의 FK 라 과제 테이블 조인이 생기지 않는다.
     */
    @Query("select s from Submission s "
            + "join fetch s.student "
            + "where s.assignment.id = :assignmentId "
            + "order by s.submittedAt asc")
    List<Submission> findByAssignmentId(@Param("assignmentId") Long assignmentId);

    /**
     * 학급 히트맵 집계용 — 학급 전체 제출을 학생과 함께 로딩한다(이름 표시 때 N+1 방지).
     * 최신 시도 선별은 서비스에서 (학급 20~30명 규모라 SQL 윈도우 함수까지 갈 필요 없음).
     *
     * s.assignment 는 일부러 fetch join 하지 않는다. 히트맵은 과제를 id 로만 그룹핑하고
     * 식별자 getter 는 프록시를 초기화하지 않는다(SubmissionFetchQueryCountTest 로 측정 = 1회).
     * 반면 과제에는 jsonb 본문(content)이 있어 fetch join 하면 제출마다 문제 전문을 함께 끌어온다.
     */
    @Query("select s from Submission s "
            + "join fetch s.student "
            + "where s.assignment.classroom.id = :classroomId "
            + "order by s.submittedAt asc")
    List<Submission> findByClassroomId(@Param("classroomId") Long classroomId);
}
