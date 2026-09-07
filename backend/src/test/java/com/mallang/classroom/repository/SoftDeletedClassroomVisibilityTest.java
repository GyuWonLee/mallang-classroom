package com.mallang.classroom.repository;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.config.JpaConfig;
import com.mallang.user.entity.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 학급 soft delete 가 조회에 제대로 반영되는지 검증한다.
 *
 * 관심사 1: 목록 쿼리는 ClassroomMember 를 루트로 두고 to-one 인 classroom 을 join fetch 한다.
 *          Classroom 의 @SQLRestriction 이 그 조인에도 적용되지 않으면, 멤버 행이 남아 있으므로
 *          삭제한 학급이 목록에 되살아난다.
 * 관심사 2: 삭제 트랜잭션 안에 멤버가 이미 로딩돼 있을 때(권한 검사 때문에 실제로 그렇다)
 *          삭제가 예외 없이 끝나는가.
 */
@DataJpaTest
@Import(JpaConfig.class)
@TestPropertySource(properties = {
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false"
})
class SoftDeletedClassroomVisibilityTest {

    @PersistenceContext
    EntityManager em;

    @Autowired
    ClassroomMemberRepository memberRepository;

    @Autowired
    ClassroomRepository classroomRepository;

    @Autowired
    com.mallang.user.repository.UserRepository userRepository;

    @Test
    void softDeletedClassroomDisappearsFromMyClassroomList() {
        User teacher = teacher();
        Classroom classroom = classroomWithOwner(teacher);
        markDeleted(classroom.getId()); // 이미 삭제된 상태를 만든다 (멤버 행은 그대로 남김)
        em.clear();                     // 1차 캐시가 아니라 실제 SQL 결과를 본다

        List<ClassroomMember> mine = memberRepository.findWithClassroomByUserId(teacher.getId());

        assertThat(mine)
                .describedAs("삭제한 학급은 내 학급 목록에서 빠져야 한다 "
                        + "(join fetch 된 to-one 에도 @SQLRestriction 이 적용되어야 함)")
                .isEmpty();
    }

    @Test
    void softDeletedClassroomIsNotFoundById() {
        Classroom classroom = classroomWithOwner(teacher());
        Long id = classroom.getId();
        markDeleted(id);
        em.clear();

        assertThat(classroomRepository.findById(id))
                .describedAs("삭제한 학급은 단건 조회에서도 없어야 한다")
                .isEmpty();
    }

    /**
     * 회귀 방지 (S15P11A407-122): 실제 삭제 경로는 권한 검사 때문에 멤버를 먼저 로딩한다.
     * 그 상태에서 학급만 지우면 살아있는 멤버가 removed 된 학급을 참조해 flush 가 터졌다.
     * 서비스가 하는 것처럼 멤버십을 먼저 정리하면 통과해야 한다.
     */
    @Test
    void deletingClassroomSucceedsWhenMembershipIsAlreadyLoaded() {
        User teacher = teacher();
        Classroom classroom = classroomWithOwner(teacher);
        memberRepository.findByClassroomIdAndUserId(classroom.getId(), teacher.getId()).orElseThrow();

        assertThatCode(() -> {
            memberRepository.deleteAll(memberRepository.findWithUserByClassroomId(classroom.getId()));
            classroomRepository.delete(classroom);
            em.flush();
        }).describedAs("멤버가 로딩된 상태에서도 학급 삭제가 예외 없이 끝나야 한다")
                .doesNotThrowAnyException();
    }

    /** 삭제 후 목록이 비는지까지 확인 — 멤버십도 함께 정리되므로 잔재가 남지 않는다 */
    @Test
    void classroomAndMembershipsAreBothGoneAfterDelete() {
        User teacher = teacher();
        Classroom classroom = classroomWithOwner(teacher);

        memberRepository.deleteAll(memberRepository.findWithUserByClassroomId(classroom.getId()));
        classroomRepository.delete(classroom);
        em.flush();
        em.clear();

        assertThat(memberRepository.findWithClassroomByUserId(teacher.getId())).isEmpty();
        assertThat(classroomRepository.findById(classroom.getId())).isEmpty();
    }

    /**
     * 학급을 지우면 그 학급 전용으로 발급된 학생 계정도 사라지고, 선생님 계정은 남아야 한다.
     * 서비스가 하는 순서(팀소속 → 멤버십 → 학생계정 → 학급) 그대로 재현한다.
     */
    @Test
    void studentAccountsAreRemovedWithClassroomButTeacherSurvives() {
        User teacher = teacher();
        Classroom classroom = classroomWithOwner(teacher);
        User student = User.createStudent("dodam01", "encoded", "김민수", "싸피초등학교", (short) 3);
        em.persist(student);
        em.persist(ClassroomMember.join(classroom, student, ClassroomRole.STUDENT));
        em.flush();

        memberRepository.deleteAll(memberRepository.findWithUserByClassroomId(classroom.getId()));
        userRepository.deleteAll(List.of(student));
        classroomRepository.delete(classroom);
        em.flush();
        em.clear();

        assertThat(userRepository.findById(student.getId()))
                .describedAs("학급 전용 학생 계정은 학급과 함께 사라진다")
                .isEmpty();
        assertThat(userRepository.findById(teacher.getId()))
                .describedAs("선생님 계정은 남는다")
                .isPresent();
        // 아이디 번호는 삭제된 계정까지 세므로 다음 발급에서 dodam01 이 재사용되지 않는다
        assertThat(userRepository.existsByUsernameIncludingDeleted("dodam01")).isTrue();
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private User teacher() {
        User teacher = User.createTeacher("teacher@school.kr", "encoded", "이선생", "싸피초등학교");
        em.persist(teacher);
        return teacher;
    }

    private Classroom classroomWithOwner(User teacher) {
        Classroom classroom = Classroom.create("3학년 2반", "dodam", List.of((short) 3));
        em.persist(classroom);
        em.persist(ClassroomMember.join(classroom, teacher, ClassroomRole.OWNER));
        em.flush();
        return classroom;
    }

    /** @SQLDelete 와 같은 결과(deleted_at 기록)를 영속성 컨텍스트를 건드리지 않고 만든다 */
    private void markDeleted(Long classroomId) {
        em.createNativeQuery("update classroom set deleted_at = current_timestamp where id = ?1")
                .setParameter(1, classroomId)
                .executeUpdate();
    }
}
