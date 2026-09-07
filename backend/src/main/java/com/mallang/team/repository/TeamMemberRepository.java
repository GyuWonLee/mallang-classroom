package com.mallang.team.repository;

import com.mallang.team.entity.Team;
import com.mallang.team.entity.TeamMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface TeamMemberRepository extends JpaRepository<TeamMember, Long> {

    @Query("select tm.team from TeamMember tm "
            + "where tm.classroom.id = :classroomId and tm.user.id = :userId")
    Optional<Team> findTeamByClassroomIdAndUserId(@Param("classroomId") Long classroomId,
                                                  @Param("userId") Long userId);

    /** 학급 전체의 (사용자 → 팀) 매핑 — 참가자 명단에서 팀을 한 번에 채우기 위해 */
    @Query("select tm.user.id as userId, tm.team.id as teamId from TeamMember tm "
            + "where tm.classroom.id = :classroomId")
    List<UserTeamView> findUserTeamsByClassroomId(@Param("classroomId") Long classroomId);

    /**
     * 학급에서 제외된 학생의 팀 소속 정리. team_member 는 soft delete 가 아니므로 행을 지운다 —
     * 남겨두면 uq_team_member_classroom_user 때문에 같은 학생의 재등록이 막힌다.
     */
    void deleteByClassroomIdAndUserId(Long classroomId, Long userId);

    /** 학급 삭제 시 팀 소속 일괄 정리 — 지워질 학생 계정을 참조한 행이 남지 않게 한다 */
    void deleteByClassroomId(Long classroomId);

    /** 팀 소속 학생 id — 팀 단위 판서 권한·미디어 제어의 대상 목록 */
    @Query("select tm.user.id from TeamMember tm where tm.team.id = :teamId")
    List<Long> findUserIdsByTeamId(@Param("teamId") Long teamId);

    /** 위 쿼리의 투영 (Spring Data 인터페이스 프로젝션) */
    interface UserTeamView {
        Long getUserId();

        Long getTeamId();
    }
}
