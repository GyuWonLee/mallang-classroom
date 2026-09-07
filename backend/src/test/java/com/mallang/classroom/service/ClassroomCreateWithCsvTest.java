package com.mallang.classroom.service;

import com.mallang.classroom.dto.ClassroomDtos.ClassroomWithStudentsResponse;
import com.mallang.classroom.dto.ClassroomDtos.CreateStudentRequest;
import com.mallang.classroom.dto.ClassroomDtos.StudentAccountResponse;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 학급 생성 + CSV 학생 일괄 등록 — S15P11A407-110 */
@ExtendWith(MockitoExtension.class)
class ClassroomCreateWithCsvTest {

    @Mock ClassroomRepository classroomRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock LiveSessionRepository liveSessionRepository;
    @Mock UserRepository userRepository;
    @Mock com.mallang.team.repository.TeamMemberRepository teamMemberRepository;
    @Mock AliasGenerator aliasGenerator;
    @Mock StudentCsvParser csvParser;
    @Mock StudentAccountIssuer studentAccountIssuer;
    @Mock com.mallang.assignment.repository.AssignmentRepository assignmentRepository;
    @Mock com.mallang.submission.repository.SubmissionRepository submissionRepository;

    private ClassroomService service;
    /** 발행된 이벤트를 담아 둔다 — 안내 메일이 실제로 나가는지는 여기까지만 확인한다 */
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
    void createsClassroomAndEveryStudentFromCsv() {
        Classroom classroom = classroomIsCreated();
        MultipartFile csv = csvFile("이름,학교,학년\n김민수,싸피초,3\n이서연,싸피초,3\n");
        when(csvParser.parse(csv)).thenReturn(List.of(
                new CreateStudentRequest("김민수", "싸피초", (short) 3),
                new CreateStudentRequest("이서연", "싸피초", (short) 3)));
        when(studentAccountIssuer.issue(any(Classroom.class), any(CreateStudentRequest.class)))
                .thenReturn(account(11L, "dodam01"), account(12L, "dodam02"));

        ClassroomWithStudentsResponse response =
                service.createClassroomWithStudents(teacher(), "3학년 2반", List.of((short) 3), csv);

        assertThat(response.id()).isEqualTo(7L);
        assertThat(response.alias()).isEqualTo("dodam");
        assertThat(response.myRole()).isEqualTo("OWNER");
        // 목록·상세와 같은 정보를 주도록 생성 응답에도 담당 학년을 싣는다
        assertThat(response.grades()).containsExactly((short) 3);
        assertThat(response.students()).hasSize(2);
        assertThat(response.students()).extracting(r -> r.username())
                .containsExactly("dodam01", "dodam02");
        // 학생 발급(계정+학급+학년팀)은 StudentAccountIssuer 가 담당 — 행마다 한 번씩
        verify(studentAccountIssuer, times(2)).issue(any(Classroom.class), any(CreateStudentRequest.class));
    }

    @Test
    void publishesMailEventOnlyForRowsThatGaveParentEmail() {
        Classroom classroom = classroomIsCreated();
        MultipartFile csv = csvFile("이름,학교,학년,학부모이메일\n김민수,싸피초,3,parent@example.com\n이서연,싸피초,3,\n");
        when(csvParser.parse(csv)).thenReturn(List.of(
                new CreateStudentRequest("김민수", "싸피초", (short) 3, "parent@example.com"),
                new CreateStudentRequest("이서연", "싸피초", (short) 3, null)));
        when(studentAccountIssuer.issue(any(Classroom.class), any(CreateStudentRequest.class)))
                .thenReturn(account(11L, "dodam01"), account(12L, "dodam02"));

        service.createClassroomWithStudents(teacher(), "3학년 2반", List.of((short) 3), csv);

        // 배치당 1건 — 학생 수만큼 올리면 비동기 큐가 넘쳐 요청 스레드로 되돌아온다
        assertThat(publishedEvents).hasSize(1);
        ClassroomService.StudentAccountsIssuedEvent event =
                (ClassroomService.StudentAccountsIssuedEvent) publishedEvents.get(0);
        assertThat(event.classroomName()).isEqualTo("3학년 2반");
        // 이메일을 준 학생만 담긴다. 나머지는 기존대로 종이 안내장이다
        assertThat(event.accounts()).hasSize(1);
        assertThat(event.accounts().get(0).parentEmail()).isEqualTo("parent@example.com");
        assertThat(event.accounts().get(0).username()).isEqualTo("dodam01");
        assertThat(event.accounts().get(0).temporaryPassword()).isEqualTo("temp1234");
    }

    @Test
    void publishesNothingWhenNobodyGaveParentEmail() {
        classroomIsCreated();
        MultipartFile csv = csvFile("김민수,싸피초,3\n");
        when(csvParser.parse(csv)).thenReturn(List.of(
                new CreateStudentRequest("김민수", "싸피초", (short) 3)));
        when(studentAccountIssuer.issue(any(Classroom.class), any(CreateStudentRequest.class)))
                .thenReturn(account(11L, "dodam01"));

        service.createClassroomWithStudents(teacher(), "3학년 2반", List.of((short) 3), csv);

        assertThat(publishedEvents).isEmpty();
    }

    @Test
    void createsClassroomOnlyWhenCsvOmitted() {
        classroomIsCreated();

        ClassroomWithStudentsResponse response =
                service.createClassroomWithStudents(teacher(), "3학년 2반", List.of((short) 3), null);

        assertThat(response.students()).isEmpty();
        verify(csvParser, never()).parse(any());
        verify(studentAccountIssuer, never()).issue(any(), any());
    }

    @Test
    void emptyCsvFileIsTreatedAsNoStudents() {
        classroomIsCreated();

        ClassroomWithStudentsResponse response =
                service.createClassroomWithStudents(teacher(), "3학년 2반", List.of((short) 3), csvFile(""));

        assertThat(response.students()).isEmpty();
        verify(csvParser, never()).parse(any());
    }

    @Test
    void csvErrorPropagatesSoClassroomRollsBack() {
        classroomIsCreated();
        MultipartFile csv = csvFile("김민수,싸피초,삼\n");
        when(csvParser.parse(csv)).thenThrow(new ApiException(HttpStatus.BAD_REQUEST,
                "invalid-csv", "1행: 학년이 숫자가 아닙니다 (삼)"));

        // 예외가 그대로 올라가야 @Transactional 이 학급 생성까지 되돌린다
        assertThatThrownBy(() -> service.createClassroomWithStudents(teacher(), "3학년 2반", List.of((short) 3), csv))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학년이 숫자가 아닙니다");
    }

    @Test
    void blankNameIsRejected() {
        assertThatThrownBy(() -> service.createClassroomWithStudents(teacher(), "   ", List.of((short) 3), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("1~50자");
        verify(classroomRepository, never()).save(any());
    }

    @Test
    void studentCannotCreateClassroom() {
        AuthUser student = new AuthUser(9L, Role.STUDENT, "학생A");

        assertThatThrownBy(() -> service.createClassroomWithStudents(student, "3학년 2반", List.of((short) 3), null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser teacher() {
        return new AuthUser(1L, Role.TEACHER, "이선생");
    }

    private MultipartFile csvFile(String content) {
        return new MockMultipartFile("students", "students.csv", "text/csv", content.getBytes());
    }

    private Classroom classroomIsCreated() {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(7L);
        lenient().when(classroom.getName()).thenReturn("3학년 2반");
        lenient().when(classroom.getAlias()).thenReturn("dodam");
        lenient().when(classroom.getGrades()).thenReturn(java.util.Set.of((short) 3));
        lenient().when(aliasGenerator.generate()).thenReturn("dodam");
        lenient().when(userRepository.getReferenceById(1L)).thenReturn(mock(User.class));
        lenient().when(classroomRepository.save(any(Classroom.class))).thenReturn(classroom);
        return classroom;
    }

    private StudentAccountResponse account(Long userId, String username) {
        return new StudentAccountResponse(userId, username, "temp1234", "학생", "싸피초", (short) 3);
    }
}
