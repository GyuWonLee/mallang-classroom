package com.mallang.team.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.team.entity.Team;
import com.mallang.team.entity.TeamMember;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.team.repository.TeamRepository;
import com.mallang.user.entity.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TeamAssignmentServiceTest {

    @Mock TeamRepository teamRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @InjectMocks TeamAssignmentService service;

    @Test
    void createsGradeTeamWhenAbsentAndEnrollsStudent() {
        Classroom classroom = mock(Classroom.class);
        when(classroom.getId()).thenReturn(1L);
        User student = mock(User.class);
        when(student.getGrade()).thenReturn((short) 3);
        when(teamRepository.findByClassroomIdAndGrade(1L, (short) 3))
                .thenReturn(Optional.empty());
        when(teamRepository.save(any(Team.class))).thenAnswer(inv -> inv.getArgument(0));

        service.assignToGradeTeam(classroom, student);

        ArgumentCaptor<Team> teamCaptor = ArgumentCaptor.forClass(Team.class);
        verify(teamRepository).save(teamCaptor.capture());
        assertThat(teamCaptor.getValue().getName()).isEqualTo("3학년");
        assertThat(teamCaptor.getValue().getGrade()).isEqualTo((short) 3);
        verify(teamMemberRepository).save(any(TeamMember.class));
    }

    @Test
    void reusesExistingGradeTeam() {
        Classroom classroom = mock(Classroom.class);
        when(classroom.getId()).thenReturn(1L);
        User student = mock(User.class);
        when(student.getGrade()).thenReturn((short) 3);
        Team existing = mock(Team.class);
        when(teamRepository.findByClassroomIdAndGrade(1L, (short) 3))
                .thenReturn(Optional.of(existing));

        service.assignToGradeTeam(classroom, student);

        verify(teamRepository, never()).save(any(Team.class));
        verify(teamMemberRepository).save(any(TeamMember.class));
    }

    @Test
    void skipsWhenGradeMissing() {
        Classroom classroom = mock(Classroom.class);
        User student = mock(User.class);
        when(student.getGrade()).thenReturn(null);

        service.assignToGradeTeam(classroom, student);

        verify(teamRepository, never()).save(any(Team.class));
        verify(teamMemberRepository, never()).save(any(TeamMember.class));
    }
}
