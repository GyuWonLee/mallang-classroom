package com.mallang.team.repository;

import com.mallang.team.entity.Team;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TeamRepository extends JpaRepository<Team, Long> {

    Optional<Team> findByIdAndClassroomId(Long id, Long classroomId);

    Optional<Team> findByClassroomIdAndGrade(Long classroomId, short grade);
}
