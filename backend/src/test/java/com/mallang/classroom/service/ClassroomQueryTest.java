package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.ClassroomDetailResponse;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomMemberResponse;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomResponse;
import com.mallang.classroom.dto.ClassroomDtos.StudentSummaryResponse;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 학급 조회 API (목록·상세·학생 명단) — S15P11A407-106 */
@ExtendWith(MockitoExtension.class)
class ClassroomQueryTest {

    @Mock ClassroomRepository classroomRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock UserRepository userRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock AliasGenerator aliasGenerator;
    @Mock StudentCsvParser csvParser;
    @Mock StudentAccountIssuer studentAccountIssuer;
    @Mock com.mallang.assignment.repository.AssignmentRepository assignmentRepository;
    @Mock com.mallang.submission.repository.SubmissionRepository submissionRepository;

    private ClassroomService service;

    @BeforeEach
    void setUp() {
        service = new ClassroomService(classroomRepository, memberRepository, liveSessionRepository,
                userRepository, teamMemberRepository, aliasGenerator, csvParser,
                studentAccountIssuer, assignmentRepository, submissionRepository, event -> { },
                mock(com.mallang.tutor.repository.AiTutorMemoryRepository.class));
    }

    @Test
    void listsClassroomsIAmMemberOfWithMyRole() {
        ClassroomMember membership = memberOfClassroom(classroom(), ClassroomRole.OWNER);
        when(memberRepository.findWithClassroomByUserId(1L)).thenReturn(List.of(membership));

        List<ClassroomResponse> result = service.listMyClassrooms(user(1L));

        // 집계 필드가 붙었다 — 집계 원본이 비어 있으면 학생 0명·수업 없음·진행률 없음이다
        // (집계 규칙 자체는 ClassroomListAggregatesTest 가 검증한다)
        assertThat(result).containsExactly(
                new ClassroomResponse(7L, "3학년 2반", "dodam", "OWNER", List.of(),
                        0, null, null));
    }

    @Test
    void detailCountsMembersAndExposesOwnerSchoolAndActiveSession() {
        Classroom classroom = classroom();
        ClassroomMember myMembership = memberOfClassroom(classroom, ClassroomRole.OWNER);
        List<ClassroomMember> roster = List.of(
                memberWithUser(person("이선생", "싸피초등학교"), ClassroomRole.OWNER),
                memberWithUser(person("김선생", "싸피초등학교"), ClassroomRole.MAINTAINER),
                memberWithUser(person("학생A", "싸피초등학교"), ClassroomRole.STUDENT),
                memberWithUser(person("학생B", "싸피초등학교"), ClassroomRole.STUDENT));
        LiveSession session = mock(LiveSession.class);
        LocalDateTime startedAt = LocalDateTime.of(2026, 7, 27, 9, 0);
        // 누가 열었는지도 응답에 실린다 — 화면이 "내가 들어갈 수 있는 수업인가"를 미리 안다.
        // person() 이 안에서 또 스터빙하므로 when(...) 안에 넣으면 UnfinishedStubbing 이 난다
        User starter = person("이선생", "싸피초등학교");
        when(session.getId()).thenReturn(77L);
        when(session.getStartedAt()).thenReturn(startedAt);
        when(session.getStartedBy()).thenReturn(starter);

        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(myMembership));
        when(memberRepository.findWithUserByClassroomId(7L)).thenReturn(roster);
        when(liveSessionRepository.findOpenWithStarterByClassroomId(7L))
                .thenReturn(List.of(session));

        ClassroomDetailResponse detail = service.getClassroom(user(1L), 7L);

        assertThat(detail.school()).isEqualTo("싸피초등학교");
        assertThat(detail.myRole()).isEqualTo("OWNER");
        assertThat(detail.memberCounts().teachers()).isEqualTo(2);
        assertThat(detail.memberCounts().students()).isEqualTo(2);
        assertThat(detail.activeSession().id()).isEqualTo(77L);
        assertThat(detail.activeSession().startedAt()).isEqualTo(startedAt);
        // 학년별 수업이 생긴 뒤로는 이 목록이 정본이다 — activeSession 은 옛 화면용 첫 건이다
        assertThat(detail.activeSessions()).hasSize(1);
        assertThat(detail.activeSessions().get(0).id()).isEqualTo(77L);
    }

    @Test
    void detailHasNullActiveSessionWhenNoOpenSession() {
        Classroom classroom = classroom();
        ClassroomMember myMembership = memberOfClassroom(classroom, ClassroomRole.STUDENT);
        List<ClassroomMember> roster =
                List.of(memberWithUser(person("학생A", "싸피초등학교"), ClassroomRole.STUDENT));

        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(myMembership));
        when(memberRepository.findWithUserByClassroomId(7L)).thenReturn(roster);
        when(liveSessionRepository.findOpenWithStarterByClassroomId(7L))
                .thenReturn(List.of());

        ClassroomDetailResponse detail = service.getClassroom(user(1L), 7L);

        assertThat(detail.activeSession()).isNull();
        // 없으면 빈 배열이다 — null 이 아니라 (화면이 length 를 바로 읽는다)
        assertThat(detail.activeSessions()).isEmpty();
        assertThat(detail.school()).isNull(); // OWNER 가 명단에 없으면 null
    }

    @Test
    void detailRejectsNonMember() {
        Classroom classroom = classroom();
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getClassroom(user(99L), 7L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원");
    }

    @Test
    void memberListIncludesTeachersWithRoleTeamAndGrade() {
        ClassroomMember myMembership = memberOfClassroom(classroom(), ClassroomRole.OWNER);
        User teacher = person("이선생", "싸피초등학교");
        when(teacher.getId()).thenReturn(1L);
        when(teacher.getGrade()).thenReturn(null); // 선생님은 학년 없음 (DB CHECK 제약)
        User studentA = person("학생A", "싸피초등학교");
        when(studentA.getId()).thenReturn(11L);
        when(studentA.getGrade()).thenReturn((short) 3);
        List<ClassroomMember> roster = List.of(
                memberWithUser(teacher, ClassroomRole.OWNER),
                memberWithUser(studentA, ClassroomRole.STUDENT));
        TeamMemberRepository.UserTeamView view = mock(TeamMemberRepository.UserTeamView.class);
        lenient().when(view.getUserId()).thenReturn(11L);
        lenient().when(view.getTeamId()).thenReturn(3L);

        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(myMembership));
        when(teamMemberRepository.findUserTeamsByClassroomId(7L)).thenReturn(List.of(view));
        when(memberRepository.findWithUserByClassroomId(7L)).thenReturn(roster);

        List<ClassroomMemberResponse> members = service.listMembers(user(1L), 7L);

        assertThat(members).containsExactly(
                new ClassroomMemberResponse(1L, "이선생", "OWNER", null, null),
                new ClassroomMemberResponse(11L, "학생A", "STUDENT", 3L, (short) 3));
    }

    @Test
    void memberListRejectsNonManager() {
        ClassroomMember myMembership = memberOfClassroom(classroom(), ClassroomRole.STUDENT);
        when(memberRepository.findByClassroomIdAndUserId(7L, 5L)).thenReturn(Optional.of(myMembership));

        assertThatThrownBy(() -> service.listMembers(user(5L), 7L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("관리자");
    }

    @Test
    void studentRosterExcludesTeachersAndTemporaryPassword() {
        ClassroomMember myMembership = memberOfClassroom(classroom(), ClassroomRole.OWNER);
        User studentA = person("학생A", "싸피초등학교");
        when(studentA.getId()).thenReturn(11L);
        when(studentA.getUsername()).thenReturn("dodam01");
        when(studentA.getGrade()).thenReturn((short) 3);
        List<ClassroomMember> roster = List.of(
                memberWithUser(person("이선생", "싸피초등학교"), ClassroomRole.OWNER),
                memberWithUser(studentA, ClassroomRole.STUDENT));

        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(myMembership));
        when(memberRepository.findWithUserByClassroomId(7L)).thenReturn(roster);

        List<StudentSummaryResponse> result = service.listStudents(user(1L), 7L);

        assertThat(result).containsExactly(
                new StudentSummaryResponse(11L, "dodam01", "학생A", "싸피초등학교", (short) 3));
    }

    @Test
    void studentRosterRejectsNonManager() {
        ClassroomMember myMembership = memberOfClassroom(classroom(), ClassroomRole.STUDENT);
        when(memberRepository.findByClassroomIdAndUserId(7L, 5L)).thenReturn(Optional.of(myMembership));

        assertThatThrownBy(() -> service.listStudents(user(5L), 7L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("관리자");
    }

    // ── 픽스처 (스터빙 중첩을 피하려고 when(...) 인자 안에서 부르지 않는다) ──────────

    private AuthUser user(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private Classroom classroom() {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(7L);
        lenient().when(classroom.getName()).thenReturn("3학년 2반");
        lenient().when(classroom.getAlias()).thenReturn("dodam");
        return classroom;
    }

    private User person(String name, String school) {
        User user = mock(User.class);
        lenient().when(user.getName()).thenReturn(name);
        lenient().when(user.getSchool()).thenReturn(school);
        return user;
    }

    private ClassroomMember memberOfClassroom(Classroom classroom, ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        lenient().when(member.getClassroom()).thenReturn(classroom);
        return member;
    }

    private ClassroomMember memberWithUser(User user, ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        lenient().when(member.getUser()).thenReturn(user);
        return member;
    }
}
