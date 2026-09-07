package com.mallang.classroom.repository;

import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ClassroomMemberRepository extends JpaRepository<ClassroomMember, Long> {

    Optional<ClassroomMember> findByClassroomIdAndUserId(Long classroomId, Long userId);

    /**
     * 삭제된 행까지 포함해 찾는다 — 재가입 경로 전용.
     *
     * <p>엔티티에 {@code @SQLRestriction("deleted_at is null")} 이 걸려 있어 위의 파생
     * 쿼리는 강퇴된 구성원을 보지 못한다. 그런데 DB 제약
     * {@code uq_classroom_member(classroom_id, user_id)} 는 삭제된 행까지 덮으므로,
     * "없다"고 판단해 새로 넣으면 유니크 위반 500 이 난다.
     * (같은 함정을 UserRepository 가 existsByUsernameIncludingDeleted 로 이미 피하고 있다.)
     *
     * <p>{@code @SQLRestriction} 은 JPQL·파생 쿼리에만 붙으므로 네이티브로 우회한다.
     */
    @Query(value = "SELECT * FROM classroom_member "
            + "WHERE classroom_id = :classroomId AND user_id = :userId", nativeQuery = true)
    Optional<ClassroomMember> findIncludingDeleted(@Param("classroomId") Long classroomId,
                                                   @Param("userId") Long userId);

    /** 내가 속한 학급 목록 — 학급을 함께 로딩(N+1 방지) */
    @Query("select cm from ClassroomMember cm join fetch cm.classroom "
            + "where cm.user.id = :userId order by cm.classroom.id")
    List<ClassroomMember> findWithClassroomByUserId(@Param("userId") Long userId);

    /**
     * 이 선생님이 관리하는 학급 중에 해당 학생이 속한 곳이 있는지 —
     * 비밀번호 초기화처럼 학급 경로가 없는 API의 권한 근거.
     */
    @Query("select count(mine) > 0 from ClassroomMember mine, ClassroomMember target "
            + "where mine.user.id = :managerId and mine.role in :manageRoles "
            + "and target.user.id = :memberId and target.classroom.id = mine.classroom.id")
    boolean managesMember(@Param("managerId") Long managerId,
                          @Param("memberId") Long memberId,
                          @Param("manageRoles") Collection<ClassroomRole> manageRoles);

    /**
     * 주어진 사용자들 중 이 학급 말고 다른 학급에도 속한 사람. 학급 삭제 시 학생 계정을 지우는데,
     * 다른 학급에도 적을 둔 계정까지 없애면 남의 학급이 망가지므로 걸러내기 위한 안전장치.
     */
    @Query("select distinct cm.user.id from ClassroomMember cm "
            + "where cm.user.id in :userIds and cm.classroom.id <> :classroomId")
    List<Long> findUserIdsBelongingToOtherClassrooms(@Param("userIds") Collection<Long> userIds,
                                                     @Param("classroomId") Long classroomId);

    /** 학급 구성원 목록 — 사용자를 함께 로딩(N+1 방지) */
    @Query("select cm from ClassroomMember cm join fetch cm.user "
            + "where cm.classroom.id = :classroomId order by cm.user.id")
    List<ClassroomMember> findWithUserByClassroomId(@Param("classroomId") Long classroomId);

    /**
     * 학급의 담당 선생님 한 명. 말랑이가 "선생님께 여쭤봐 줄까?" 를 실행할 때 받는 사람이다.
     * 학급당 OWNER 는 하나지만, 데이터가 어긋나도 조회가 터지지 않게 First 로 받는다.
     */
    Optional<ClassroomMember> findFirstByClassroomIdAndRole(Long classroomId, ClassroomRole role);

    @Query("select cm.user.id from ClassroomMember cm where cm.classroom.id = :classroomId")
    List<Long> findUserIdsByClassroomId(@Param("classroomId") Long classroomId);

    /**
     * 학급별 학생 수 — 목록 화면이 카드마다 인원을 보여준다. 학급마다 세면 왕복이 학급 수만큼 는다.
     * 학생이 하나도 없는 학급은 행이 안 나오므로 호출부가 0으로 채운다.
     */
    @Query("select cm.classroom.id as classroomId, count(cm) as students "
            + "from ClassroomMember cm "
            + "where cm.classroom.id in :classroomIds and cm.role = com.mallang.classroom.entity.ClassroomRole.STUDENT "
            + "group by cm.classroom.id")
    List<StudentCountView> countStudentsByClassroomIds(
            @Param("classroomIds") Collection<Long> classroomIds);

    interface StudentCountView {
        Long getClassroomId();

        long getStudents();
    }

    @Query("select cm.user.id from ClassroomMember cm "
            + "where cm.classroom.id = :classroomId and cm.role in :roles")
    List<Long> findUserIdsByClassroomIdAndRoleIn(@Param("classroomId") Long classroomId,
                                                 @Param("roles") Collection<ClassroomRole> roles);

    /**
     * 학급의 학생과 그 학년 — 과제가 <b>누구를 대상으로 하는지</b> 가리는 데 쓴다.
     *
     * <p>학년까지 함께 받는 이유는 대상 판정이 학년으로도 이뤄지기 때문이다
     * ({@code Assignment.isVisibleTo}). id 만 받아 오면 학년을 다시 물어야 하고, 그러면
     * 학생 수만큼 왕복이 늘어난다.</p>
     */
    @Query("select cm.user.id as studentId, cm.user.grade as grade from ClassroomMember cm "
            + "where cm.classroom.id = :classroomId and cm.role = :role")
    List<StudentGradeView> findStudentGrades(@Param("classroomId") Long classroomId,
                                             @Param("role") ClassroomRole role);

    interface StudentGradeView {
        Long getStudentId();

        Short getGrade();
    }

    /**
     * 두 사람이 같은 학급에 함께 속해 있는가 — 채팅 라우팅이 학급 밖으로 새지 않게 하는 판정.
     *
     * <p>선생님은 여러 학급을 맡을 수 있고 학생은 한 학급에만 속하므로, 겹치는 학급이
     * 하나라도 있으면 참이다. {@code @SQLRestriction} 이 걸린 엔티티라 강퇴된 구성원은
     * 자동으로 빠진다 — 학급에서 빼낸 선생님이 계속 답장할 수 있으면 안 된다.
     */
    @Query("select count(a) > 0 from ClassroomMember a, ClassroomMember b "
            + "where a.classroom.id = b.classroom.id "
            + "and a.user.id = :userIdA and b.user.id = :userIdB")
    boolean shareClassroom(@Param("userIdA") Long userIdA, @Param("userIdB") Long userIdB);
}
