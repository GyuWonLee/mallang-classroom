package com.mallang.note.repository;

import com.mallang.note.entity.StudentNote;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StudentNoteRepository extends JpaRepository<StudentNote, Long> {

    /**
     * 이 학급의 이 학생에 대한 메모 — 최근 것이 위로. 작성자 이름을 함께 쓰므로
     * 함께 로딩한다(메모마다 선생님을 다시 읽으면 N+1).
     */
    @EntityGraph(attributePaths = "author")
    List<StudentNote> findByClassroomIdAndStudentIdOrderByCreatedAtDesc(
            Long classroomId, Long studentId);

    /** 수정·삭제 권한 검사에 작성자와 학급이 필요하다. */
    @EntityGraph(attributePaths = {"author", "classroom"})
    Optional<StudentNote> findById(Long id);
}
