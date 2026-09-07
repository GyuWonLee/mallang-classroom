package com.mallang.submission.repository;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.entity.AssignmentSource;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.classroom.entity.Classroom;
import com.mallang.global.config.JpaConfig;
import com.mallang.submission.entity.Submission;
import com.mallang.user.entity.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.boot.jdbc.test.autoconfigure.AutoConfigureTestDatabase;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 조회 쿼리 수를 실제로 세어 N+1 을 판정한다.
 *
 * 리뷰 지적 두 건을 검증하려고 만들었고, 결과는 갈렸다:
 *  ① findByAssignmentId 후 student.getName() → 파생 쿼리 시절 2회로 측정됐다(실제 문제).
 *     default_batch_fetch_size=100 덕에 1+N 이 아니라 1+1 로 눌려 있었지만,
 *     fetch join 으로 없앨 수 있는 왕복이라 고쳤다.
 *  ② findByClassroomId 후 assignment.getId() → 1회. 식별자 getter 는 프록시를 깨우지 않는다.
 *     지적이 틀렸고, assignment 를 fetch join 하면 jsonb 본문까지 끌어와 오히려 손해다.
 *
 * 두 규칙 다 회귀하기 쉬우니(파생 쿼리로 되돌리기, 과제 필드 접근 추가) 테스트로 못을 박아둔다.
 */
@ExtendWith(SpringExtension.class)
@DataJpaTest
// NONE: @DataJpaTest 기본값은 데이터소스를 자체 임베디드로 갈아치워 아래 INIT 이 무시된다
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(JpaConfig.class)
@TestPropertySource(properties = {
        // 엔티티에 jsonb 컬럼이 있어 H2 DDL 이 깨진다. 도메인으로 text 에 매핑해두면 통과한다.
        // 전용 DB 이름 — 다른 테스트가 쓰는 mallang-test 스키마를 건드리지 않는다.
        "spring.datasource.url=jdbc:h2:mem:fetch-count;MODE=PostgreSQL"
                + ";INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS TEXT",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false",
        "spring.jpa.properties.hibernate.generate_statistics=true"
})
class SubmissionFetchQueryCountTest {

    private static final int STUDENT_COUNT = 5;

    @PersistenceContext
    EntityManager em;

    @Autowired
    SubmissionRepository submissionRepository;

    private Statistics statistics;
    private Long assignmentId;
    private Long classroomId;
    private Long studentId;

    @BeforeEach
    void seed() {
        Classroom classroom = Classroom.create("3학년 2반", "dodam", List.of((short) 3));
        em.persist(classroom);
        User teacher = User.createTeacher("t@school.kr", "enc", "이선생", "싸피초");
        em.persist(teacher);
        Assignment assignment = Assignment.create(classroom, teacher, "받아쓰기",
                Subject.KOREAN, 2, AssignmentType.DICTATION, AssignmentSource.MANUAL,
                "{\"problems\":[]}", null, null, null);
        em.persist(assignment);

        User firstStudent = null;
        for (int i = 1; i <= STUDENT_COUNT; i++) {
            User student = User.createStudent("dodam0" + i, "enc", "학생" + i, "싸피초", (short) 3);
            em.persist(student);
            if (firstStudent == null) {
                firstStudent = student;
            }
            em.persist(Submission.create(assignment, student, "{}", (short) 80,
                    "[{\"no\":1,\"correct\":true,\"conceptTags\":[\"겹받침\"]}]", 1));
        }
        em.flush();
        classroomId = classroom.getId();
        assignmentId = assignment.getId();
        studentId = firstStudent.getId();
        em.clear();

        statistics = em.getEntityManagerFactory().unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
    }

    @Test
    void findByAssignmentIdLoadsStudentsInOneQuery() {
        List<Submission> submissions = submissionRepository.findByAssignmentId(assignmentId);
        // 서비스가 하는 것과 동일하게 학생 이름(식별자 아님)에 접근
        submissions.forEach(s -> s.getStudent().getName());

        assertThat(statistics.getPrepareStatementCount())
                .describedAs("제출 조회 1번으로 끝나야 한다 (학생당 추가 쿼리가 없어야 함)")
                .isEqualTo(1);
    }

    /**
     * 리포트 집계 경로. 쿼리 수도 수지만 여기서 지키려는 건 <b>지연 로딩이 아예 없다</b>는 것이다 —
     * 그래야 집계 호출부에 트랜잭션이 필요 없고, 리포트의 GMS 왕복(1~2초)을 트랜잭션 밖으로
     * 뺄 수 있다. 엔티티를 다시 끌어오는 변경을 하면 이 테스트가 먼저 깨진다.
     */
    @Test
    void findReportRowsReadsScalarsInOneQuery() {
        List<SubmissionRepository.ReportRowView> rows =
                submissionRepository.findReportRows(classroomId, studentId);
        rows.forEach(row -> {
            row.getAssignmentId();
            row.getType();
            row.getResults();
        });

        assertThat(rows).hasSize(1);
        assertThat(statistics.getPrepareStatementCount())
                .describedAs("스칼라 프로젝션이라 깨울 프록시가 없다 — 1번이어야 한다")
                .isEqualTo(1);
    }

    @Test
    void findByClassroomIdDoesNotInitializeAssignmentProxyForIdAccess() {
        List<Submission> submissions = submissionRepository.findByClassroomId(classroomId);
        // 히트맵은 과제 id 로만 그룹핑한다 — 식별자 접근이 프록시를 깨우는지 확인
        submissions.forEach(s -> {
            s.getStudent().getName();
            s.getAssignment().getId();
        });

        assertThat(statistics.getPrepareStatementCount())
                .describedAs("식별자 getter 는 프록시를 초기화하지 않으므로 1번이어야 한다")
                .isEqualTo(1);
    }
}
