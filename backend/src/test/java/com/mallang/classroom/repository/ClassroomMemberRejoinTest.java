package com.mallang.classroom.repository;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.config.JpaConfig;
import com.mallang.user.entity.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 제외했던 선생님을 다시 초대했을 때 재가입이 되는지.
 *
 * <p>이 테스트가 필요한 이유는 목으로는 절대 잡히지 않는 함정이기 때문이다.
 * {@link ClassroomMember} 에는 {@code @SQLRestriction("deleted_at is null")} 이 걸려 있어
 * 파생 조회가 강퇴된 행을 못 본다. 그런데 DB 의
 * {@code uq_classroom_member(classroom_id, user_id)} 는 <b>삭제된 행까지 덮는다</b>.
 * 그래서 "조회해서 없으면 새로 넣는다"는 지극히 평범한 코드가 유니크 위반 500 을 낸다 —
 * 단위 테스트에서 리포지토리를 목으로 두면 이 어긋남 자체가 사라져 통과해 버린다.
 *
 * <p>학급 생성 500(V20)도 같은 모양이었다. 이번에는 실제 스키마 위에서 고정해 둔다.
 */
@DataJpaTest
@Import(JpaConfig.class)
@TestPropertySource(properties = {
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false"
})
class ClassroomMemberRejoinTest {

    @PersistenceContext
    EntityManager em;

    @Autowired
    ClassroomMemberRepository memberRepository;

    @Test
    @DisplayName("강퇴된 구성원은 일반 조회에선 안 보이지만 삭제 포함 조회로는 찾힌다")
    void softDeletedMemberIsInvisibleToTheDerivedQueryButFoundByTheNativeOne() {
        Classroom classroom = classroom();
        User teacher = teacher("t1@school.kr");
        ClassroomMember member = member(classroom, teacher, ClassroomRole.MAINTAINER);

        memberRepository.delete(member); // @SQLDelete → deleted_at 기록
        em.flush();
        em.clear();

        assertThat(memberRepository.findByClassroomIdAndUserId(classroom.getId(), teacher.getId()))
                .describedAs("@SQLRestriction 때문에 일반 조회는 강퇴된 행을 못 본다")
                .isEmpty();
        assertThat(memberRepository.findIncludingDeleted(classroom.getId(), teacher.getId()))
                .describedAs("그런데 유니크 제약은 이 행을 여전히 세고 있다 — 재가입 경로는 이 사실을 알아야 한다")
                .isPresent();
    }

    @Test
    @DisplayName("재가입은 새 행이 아니라 기존 행을 되살린다 — 새로 넣으면 유니크 위반이다")
    void rejoinRevivesTheExistingRowInsteadOfInsertingANewOne() {
        Classroom classroom = classroom();
        User teacher = teacher("t2@school.kr");
        member(classroom, teacher, ClassroomRole.MAINTAINER);

        memberRepository.delete(memberRepository
                .findByClassroomIdAndUserId(classroom.getId(), teacher.getId()).orElseThrow());
        em.flush();
        em.clear();

        ClassroomMember revived = memberRepository
                .findIncludingDeleted(classroom.getId(), teacher.getId()).orElseThrow();
        assertThat(revived.isDeleted()).isTrue();
        revived.restore(ClassroomRole.MAINTAINER);
        em.flush();
        em.clear();

        assertThat(memberRepository.findByClassroomIdAndUserId(classroom.getId(), teacher.getId()))
                .describedAs("되살린 뒤에는 정상 구성원으로 보여야 한다")
                .isPresent()
                .get()
                .extracting(ClassroomMember::getRole)
                .isEqualTo(ClassroomRole.MAINTAINER);

        Long rows = (Long) em.createQuery(
                        "select count(m) from ClassroomMember m where m.classroom.id = :c")
                .setParameter("c", classroom.getId())
                .getSingleResult();
        assertThat(rows)
                .describedAs("행이 늘어나면 안 된다 — 늘어났다면 유니크 제약이 있는 운영에선 500 이다")
                .isEqualTo(2L); // 개설 선생님 + 되살아난 선생님
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private Classroom classroom() {
        Classroom classroom = Classroom.create("3학년 2반", "dodam" + System.nanoTime(),
                List.of((short) 3));
        em.persist(classroom);
        em.persist(ClassroomMember.join(classroom, teacher("owner" + System.nanoTime() + "@x.kr"),
                ClassroomRole.OWNER));
        em.flush();
        return classroom;
    }

    private User teacher(String email) {
        User teacher = User.createTeacher(email, "encoded", "이선생", "싸피초등학교");
        em.persist(teacher);
        return teacher;
    }

    private ClassroomMember member(Classroom classroom, User user, ClassroomRole role) {
        ClassroomMember member = ClassroomMember.join(classroom, user, role);
        em.persist(member);
        em.flush();
        return member;
    }
}
