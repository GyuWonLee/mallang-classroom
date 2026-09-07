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
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 학생 메모 (명세 §11.3 #8).
 *
 * <p>다른 학생 단위 조회(리포트·출석)와 결정적으로 다른 점은 <b>학생 본인이 볼 수 없다</b>는
 * 것이다. 학생에 대한 관찰 기록이라 본인 열람을 허용하면 선생님이 솔직하게 쓸 수 없다.
 * 그래서 여기서는 "선생님 또는 본인"이 아니라 관리자 전용이다.</p>
 *
 * <p>읽기는 학급 선생님 전체, 수정·삭제는 작성자만 — 부담임도 학생 파악에 메모가 필요하지만
 * 남의 관찰을 고쳐 쓰면 그건 더 이상 기록이 아니다.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class StudentNoteService {

    private final AssignmentAccessGuard accessGuard;
    private final StudentNoteRepository noteRepository;
    private final ClassroomMemberRepository memberRepository;
    private final UserRepository userRepository;

    public List<NoteResponse> list(AuthUser viewer, Long classroomId, Long studentId) {
        requireTeacher(viewer, classroomId);
        return noteRepository
                .findByClassroomIdAndStudentIdOrderByCreatedAtDesc(classroomId, studentId).stream()
                .map(note -> NoteResponse.of(note, viewer.id()))
                .toList();
    }

    @Transactional
    public NoteResponse write(AuthUser author, Long classroomId, Long studentId,
                              WriteNoteRequest request) {
        requireTeacher(author, classroomId);
        memberRepository.findByClassroomIdAndUserId(classroomId, studentId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));

        Classroom classroom = accessGuard.findClassroom(classroomId);
        StudentNote note = noteRepository.save(StudentNote.write(
                classroom,
                userRepository.getReferenceById(studentId),
                userRepository.getReferenceById(author.id()),
                request.content()));
        return NoteResponse.of(note, author.id());
    }

    @Transactional
    public NoteResponse edit(AuthUser editor, Long noteId, WriteNoteRequest request) {
        StudentNote note = requireAuthor(editor, noteId);
        note.edit(request.content());
        return NoteResponse.of(note, editor.id());
    }

    @Transactional
    public void delete(AuthUser remover, Long noteId) {
        noteRepository.delete(requireAuthor(remover, noteId));
    }

    /**
     * 메모를 손대려면 학급 선생님이면서 그 메모의 작성자여야 한다.
     * 학급 확인을 먼저 하는 이유는, 학급 밖 사람에게 "그 메모는 남의 것"이라고 알려 줄 이유가 없어서다.
     */
    private StudentNote requireAuthor(AuthUser user, Long noteId) {
        StudentNote note = noteRepository.findById(noteId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "note-not-found",
                        "메모를 찾을 수 없습니다."));
        requireTeacher(user, note.getClassroom().getId());
        if (!note.getAuthor().getId().equals(user.id())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-note-author",
                    "메모는 작성자만 수정·삭제할 수 있습니다.");
        }
        return note;
    }

    private void requireTeacher(AuthUser user, Long classroomId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, user.id());
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "note-teacher-only",
                    "학급 선생님만 메모를 보거나 남길 수 있습니다.");
        }
    }
}
