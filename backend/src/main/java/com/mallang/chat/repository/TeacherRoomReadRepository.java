package com.mallang.chat.repository;

import com.mallang.chat.entity.TeacherRoomRead;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TeacherRoomReadRepository extends JpaRepository<TeacherRoomRead, Long> {

    Optional<TeacherRoomRead> findByClassroomIdAndUserId(Long classroomId, Long userId);
}
