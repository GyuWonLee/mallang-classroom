package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.CreateStudentRequest;
import com.mallang.classroom.dto.ClassroomDtos.StudentCsvRowResponse;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * CSV 미리보기 — 올린 파일이 무엇으로 읽혔는지 보여 주고 등록은 하지 않는다.
 *
 * <p>이 테스트가 지키는 것은 하나다: <b>미리보기는 아무것도 만들지 않는다.</b> 여기가 무너지면
 * "확인 절차"가 확인이 아니라 두 번 등록이 된다.</p>
 */
@ExtendWith(MockitoExtension.class)
class ClassroomCsvPreviewTest {

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
    /** 안내 메일 이벤트가 새어 나가는지 본다 — 미리보기에서는 한 건도 없어야 한다 */
    private final List<Object> publishedEvents = new ArrayList<>();

    @BeforeEach
    void setUp() {
        publishedEvents.clear();
        service = new ClassroomService(classroomRepository, memberRepository, liveSessionRepository,
                userRepository, teamMemberRepository, aliasGenerator, csvParser,
                studentAccountIssuer, assignmentRepository, submissionRepository,
                publishedEvents::add,
                mock(com.mallang.tutor.repository.AiTutorMemoryRepository.class));
    }

    @Test
    void returnsEveryRowTheParserRead() {
        managerOfClassroom();
        MultipartFile csv = csvFile("이름,학교,학년,학부모이메일\n김민수,싸피초,3,parent@example.com\n이서연,싸피초,3,\n");
        when(csvParser.parse(csv)).thenReturn(List.of(
                new CreateStudentRequest("김민수", "싸피초", (short) 3, "parent@example.com"),
                new CreateStudentRequest("이서연", "싸피초", (short) 3, null)));

        List<StudentCsvRowResponse> rows = service.previewStudentsBulk(user(1L), 7L, csv);

        assertThat(rows).hasSize(2);
        assertThat(rows).extracting(StudentCsvRowResponse::name).containsExactly("김민수", "이서연");
        assertThat(rows.get(0).school()).isEqualTo("싸피초");
        assertThat(rows.get(0).grade()).isEqualTo((short) 3);
        // 메일이 갈 행과 안 갈 행이 화면에서 구분돼야 한다 — 선생님이 확인하는 것이 바로 이것이다
        assertThat(rows.get(0).parentEmail()).isEqualTo("parent@example.com");
        assertThat(rows.get(1).parentEmail()).isNull();
    }

    @Test
    void createsNothingAndSendsNothing() {
        managerOfClassroom();
        MultipartFile csv = csvFile("김민수,싸피초,3,parent@example.com\n");
        when(csvParser.parse(csv)).thenReturn(List.of(
                new CreateStudentRequest("김민수", "싸피초", (short) 3, "parent@example.com")));

        service.previewStudentsBulk(user(1L), 7L, csv);

        // 계정도, 안내 메일도 없다. 등록은 선생님이 확인한 뒤 /students/bulk 에서 일어난다
        verify(studentAccountIssuer, never()).issue(any(), any());
        assertThat(publishedEvents).isEmpty();
    }

    @Test
    void rejectsSomeoneWhoDoesNotManageTheClassroom() {
        Classroom classroom = mock(Classroom.class);
        // mock 은 스터빙 밖에서 먼저 만든다 — thenReturn 인자 안에서 만들면 스터빙이 겹쳐 터진다
        ClassroomMember student = member(ClassroomRole.STUDENT);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 5L)).thenReturn(Optional.of(student));

        // 미리보기도 남의 학급 명단을 읽는 일이라 등록과 같은 문을 지난다
        assertThatThrownBy(() -> service.previewStudentsBulk(user(5L), 7L, csvFile("김민수,싸피초,3\n")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("관리자");
        verify(csvParser, never()).parse(any());
    }

    @Test
    void letsTheParsersErrorThrough() {
        managerOfClassroom();
        MultipartFile csv = csvFile("김민수,싸피초,아홉\n");
        when(csvParser.parse(csv)).thenThrow(new ApiException(HttpStatus.BAD_REQUEST, "invalid-csv",
                "1행: 학년이 숫자가 아닙니다 (아홉)"));

        // 몇 행이 왜 틀렸는지가 그대로 화면에 닿아야 한다 — 미리보기가 가장 쓸모 있는 순간이다
        assertThatThrownBy(() -> service.previewStudentsBulk(user(1L), 7L, csv))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("1행");
    }

    private void managerOfClassroom() {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(7L);
        ClassroomMember owner = member(ClassroomRole.OWNER);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(memberRepository.findByClassroomIdAndUserId(7L, 1L)).thenReturn(Optional.of(owner));
    }

    private ClassroomMember member(ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        return member;
    }

    private AuthUser user(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private MultipartFile csvFile(String body) {
        return new MockMultipartFile("file", "students.csv", "text/csv",
                body.getBytes(StandardCharsets.UTF_8));
    }
}
