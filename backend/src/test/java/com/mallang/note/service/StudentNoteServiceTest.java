package com.mallang.note.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.note.dto.NoteDtos.NoteResponse;
import com.mallang.note.dto.NoteDtos.WriteNoteRequest;
import com.mallang.note.entity.StudentNote;
import com.mallang.note.repository.StudentNoteRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

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
 * 학생 메모 — S15P11A407-137
 *
 * <p>선생님 7 화면의 '메모' 탭은 API·컬럼이 모두 없었다(§11.3 #8).</p>
 *
 * <p>다른 조회 API(리포트·출석)와 결정적으로 다른 점은 <b>학생 본인이 볼 수 없다</b>는 것이다.
 * 학생에 대한 관찰 기록이라 본인 열람을 허용하면 선생님이 솔직하게 쓸 수 없다.
 * 여기 테스트의 절반이 그 경계를 지킨다.</p>
 */
@ExtendWith(MockitoExtension.class)
class StudentNoteServiceTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long STUDENT_ID = 20L;
    private static final Long TEACHER_ID = 1L;
    private static final Long OTHER_TEACHER_ID = 2L;
    private static final Long NOTE_ID = 77L;

    @Mock AssignmentAccessGuard accessGuard;
    @Mock StudentNoteRepository noteRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock UserRepository userRepository;

    private StudentNoteService service;

    @BeforeEach
    void setUp() {
        service = new StudentNoteService(
                accessGuard, noteRepository, memberRepository, userRepository);
    }

    @Test
    void teacherWritesANote() {
        manager(TEACHER_ID);
        studentIsInClassroom();
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(any())).thenReturn(mock(User.class));
        when(noteRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.write(teacher(), CLASSROOM_ID, STUDENT_ID, new WriteNoteRequest("숙제를 잘 챙겨 옵니다"));

        verify(noteRepository).save(any(StudentNote.class));
    }

    @Test
    void studentCannotReadNotesAboutThemselves() {
        when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(ClassroomRole.STUDENT);

        // 본인이 볼 수 있으면 선생님이 솔직하게 쓸 수 없다 — 리포트·출석과 다른 지점이다
        assertThatThrownBy(() -> service.list(
                new AuthUser(STUDENT_ID, Role.STUDENT, "김민수"), CLASSROOM_ID, STUDENT_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");

        verify(noteRepository, never()).findByClassroomIdAndStudentIdOrderByCreatedAtDesc(
                any(), any());
    }

    @Test
    void studentCannotWriteNotesEither() {
        when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service.write(
                new AuthUser(STUDENT_ID, Role.STUDENT, "김민수"), CLASSROOM_ID, STUDENT_ID,
                new WriteNoteRequest("내가 쓴 메모")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님만");
    }

    @Test
    void anyTeacherInTheClassroomCanReadNotes() {
        manager(OTHER_TEACHER_ID);
        // 목을 미리 만들어 둔다 — when(...) 안에서 다른 목을 스텁하면 중첩 스텁이 된다
        List<StudentNote> existing = List.of(note(TEACHER_ID, "관찰 기록"));
        when(noteRepository.findByClassroomIdAndStudentIdOrderByCreatedAtDesc(
                CLASSROOM_ID, STUDENT_ID)).thenReturn(existing);

        // 부담임도 학생 파악에 필요하다 — 읽기는 학급 선생님 전체
        List<NoteResponse> notes = service.list(
                new AuthUser(OTHER_TEACHER_ID, Role.TEACHER, "부담임"), CLASSROOM_ID, STUDENT_ID);

        assertThat(notes).hasSize(1);
        assertThat(notes.get(0).content()).isEqualTo("관찰 기록");
    }

    @Test
    void onlyTheAuthorCanEditTheirNote() {
        manager(OTHER_TEACHER_ID);
        found(note(TEACHER_ID, "원본"));

        // 읽기는 함께 하되 고치는 건 쓴 사람만 — 남의 관찰을 고쳐 쓰면 기록이 아니게 된다
        assertThatThrownBy(() -> service.edit(
                new AuthUser(OTHER_TEACHER_ID, Role.TEACHER, "부담임"), NOTE_ID,
                new WriteNoteRequest("고쳐 씀")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("작성자");
    }

    @Test
    void authorEditsTheirOwnNote() {
        manager(TEACHER_ID);
        StudentNote note = note(TEACHER_ID, "원본");
        found(note);

        service.edit(teacher(), NOTE_ID, new WriteNoteRequest("고친 내용"));

        assertThat(note.getContent()).isEqualTo("고친 내용");
    }

    @Test
    void onlyTheAuthorCanDeleteTheirNote() {
        manager(OTHER_TEACHER_ID);
        found(note(TEACHER_ID, "원본"));

        assertThatThrownBy(() -> service.delete(
                new AuthUser(OTHER_TEACHER_ID, Role.TEACHER, "부담임"), NOTE_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("작성자");

        verify(noteRepository, never()).delete(any());
    }

    @Test
    void authorDeletesTheirOwnNote() {
        manager(TEACHER_ID);
        StudentNote note = note(TEACHER_ID, "원본");
        found(note);

        service.delete(teacher(), NOTE_ID);

        verify(noteRepository).delete(note);
    }

    @Test
    void cannotWriteANoteAboutSomeoneOutsideTheClassroom() {
        manager(TEACHER_ID);
        when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.write(teacher(), CLASSROOM_ID, STUDENT_ID,
                new WriteNoteRequest("메모")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void manager(Long userId) {
        lenient().when(accessGuard.requireMember(CLASSROOM_ID, userId))
                .thenReturn(ClassroomRole.OWNER);
    }

    private void studentIsInClassroom() {
        Optional<com.mallang.classroom.entity.ClassroomMember> member =
                Optional.of(mock(com.mallang.classroom.entity.ClassroomMember.class));
        lenient().when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(member);
    }

    private void found(StudentNote note) {
        Optional<StudentNote> result = Optional.of(note);
        lenient().when(noteRepository.findById(NOTE_ID)).thenReturn(result);
    }

    /** 내용이 실제로 바뀌는지 봐야 하므로 목이 아니라 진짜 엔티티를 쓴다. */
    private StudentNote note(Long authorId, String content) {
        User author = mock(User.class);
        lenient().when(author.getId()).thenReturn(authorId);
        lenient().when(author.getName()).thenReturn("김선생");
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(CLASSROOM_ID);
        return StudentNote.write(classroom, mock(User.class), author, content);
    }

    private AuthUser teacher() {
        return new AuthUser(TEACHER_ID, Role.TEACHER, "김선생");
    }
}
