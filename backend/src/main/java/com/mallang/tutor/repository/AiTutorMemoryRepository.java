package com.mallang.tutor.repository;

import com.mallang.tutor.entity.AiTutorMemory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AiTutorMemoryRepository extends JpaRepository<AiTutorMemory, Long> {

    /** 학급+학생당 한 행 — 있으면 이어서 요약을 갱신하고, 없으면 새로 만든다. */
    Optional<AiTutorMemory> findByClassroomIdAndStudentId(Long classroomId, Long studentId);

    /**
     * 그 학급에서 그 학생의 기억을 지운다 — 학급을 떠날 때 부른다.
     *
     * <p>남겨 두면 두 가지가 어긋난다. 하나는 <b>아이가 털어놓은 이야기를 요약한 글</b>이
     * 더 이상 그 학급의 아이가 아닌 사람 몫으로 남는다는 것이고, 다른 하나는 나중에 같은
     * 학급에 다시 들어왔을 때 <b>말랑이가 지난 학기 대화를 기억하는 것처럼 군다</b>는 것이다.
     * 뒤쪽은 눈에 보이는 오작동이다 — 처음 말을 거는데 "저번에 물어본 그거"라고 답한다.</p>
     */
    void deleteByClassroomIdAndStudentId(Long classroomId, Long studentId);
}
