package com.mallang.assignment.repository;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.entity.AssignmentSource;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.classroom.entity.Classroom;
import com.mallang.global.config.JpaConfig;
import com.mallang.user.entity.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
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
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 공개 대상 필터(findVisibleToStudent) 를 실 DB 로 검증한다 — 접근 제어의 핵심이라 못을 박아둔다.
 * 규칙: 대상이 비면 학급 전체, 지정되면 그 학생만. 초안(미발행)은 누구에게도 안 보인다.
 */
@ExtendWith(SpringExtension.class)
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(JpaConfig.class)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:assignment-target;MODE=PostgreSQL"
                + ";INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS TEXT",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false"
})
class AssignmentTargetRepositoryTest {

    @PersistenceContext
    EntityManager em;

    @Autowired
    AssignmentRepository assignmentRepository;

    private Long classroomId;
    private Long studentAId;
    private Long studentBId;

    @BeforeEach
    void seed() {
        Classroom classroom = Classroom.create("1·3학년 복식", "dodam", List.of((short) 1, (short) 3));
        em.persist(classroom);
        classroomId = classroom.getId();
        User teacher = User.createTeacher("t@school.kr", "enc", "이선생", "싸피초");
        em.persist(teacher);
        User studentA = User.createStudent("dodam-a", "enc", "학생A", "싸피초", (short) 1);
        User studentB = User.createStudent("dodam-b", "enc", "학생B", "싸피초", (short) 3);
        em.persist(studentA);
        em.persist(studentB);
        studentAId = studentA.getId();
        studentBId = studentB.getId();

        // A=1학년, B=3학년
        persistAssignment(classroom, teacher, "전체 공개", Assignment.Targets.none(), true);
        persistAssignment(classroom, teacher, "A만",
                new Assignment.Targets(Set.of(), Set.of(studentAId)), true);   // A 학생에게만
        persistAssignment(classroom, teacher, "1학년만",
                new Assignment.Targets(Set.of((short) 1), Set.of()), true);    // 1학년(A)에게만
        persistAssignment(classroom, teacher, "초안(미발행)", Assignment.Targets.none(), false);
        em.flush();
        em.clear();
    }

    private void persistAssignment(Classroom classroom, User teacher, String title,
                                   Assignment.Targets targets, boolean published) {
        Assignment a = Assignment.create(classroom, teacher, title, Subject.KOREAN, 1,
                AssignmentType.DICTATION, AssignmentSource.MANUAL, "{\"problems\":[]}", null, null,
                targets);
        if (published) {
            a.publish();
        }
        em.persist(a);
    }

    @Test
    void studentSeesWholeClassAndOwnGradeAndOwnTargetedButNotOthers() {
        List<Assignment> forA = assignmentRepository
                .findVisibleToStudent(classroomId, studentAId, (short) 1); // 1학년 A
        assertThat(forA).extracting(Assignment::getTitle)
                .containsExactlyInAnyOrder("전체 공개", "A만", "1학년만"); // 초안 제외

        List<Assignment> forB = assignmentRepository
                .findVisibleToStudent(classroomId, studentBId, (short) 3); // 3학년 B
        assertThat(forB).extracting(Assignment::getTitle)
                .containsExactlyInAnyOrder("전체 공개"); // 'A만'·'1학년만'은 안 보임
    }
}
