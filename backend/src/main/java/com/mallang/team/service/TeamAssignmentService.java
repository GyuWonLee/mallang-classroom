package com.mallang.team.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.team.entity.Team;
import com.mallang.team.entity.TeamMember;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.team.repository.TeamRepository;
import com.mallang.user.entity.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class TeamAssignmentService {

    private final TeamRepository teamRepository;
    private final TeamMemberRepository teamMemberRepository;

    /**
     * 학급의 "{n}학년" 팀에 학생을 편입 — 없으면 팀을 만든다.
     * 학생 등록 트랜잭션 안에서 호출된다 (팀 편입 실패 = 등록 전체 롤백).
     * 동시 생성 경합은 uq_team_classroom_grade 부분 유니크 인덱스가 최종 방어.
     */
    public void assignToGradeTeam(Classroom classroom, User student) {
        Short grade = student.getGrade();
        if (grade == null) {
            return; // DB 제약상 학생은 항상 학년이 있지만, 방어적으로
        }
        Team team = teamRepository.findByClassroomIdAndGrade(classroom.getId(), grade)
                .orElseGet(() -> teamRepository.save(Team.gradeTeam(classroom, grade)));
        teamMemberRepository.save(TeamMember.join(team, classroom, student));
    }
}
