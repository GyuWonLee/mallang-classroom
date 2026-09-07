package com.mallang.assignment.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.global.error.ApiException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * 과제 API의 학급 권한 관문. ClassroomService.requireManager와 동일한 멤버십 기준을 재사용한다
 * (권한은 CLASSROOM_MEMBER.role 기준 — 설계 원칙).
 */
@Component
@RequiredArgsConstructor
public class AssignmentAccessGuard {

    private final ClassroomRepository classroomRepository;
    private final ClassroomMemberRepository memberRepository;

    public Classroom findClassroom(Long classroomId) {
        return classroomRepository.findById(classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "classroom-not-found",
                        "학급을 찾을 수 없습니다."));
    }

    /** OWNER/MAINTAINER 검증 후 학급 반환. */
    public Classroom requireManager(Long classroomId, Long userId) {
        Classroom classroom = findClassroom(classroomId);
        if (!role(classroomId, userId).canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "manager-only",
                    "학급 관리자(OWNER/MAINTAINER)만 가능합니다.");
        }
        return classroom;
    }

    /** 학급 구성원 여부만 검증하고 역할 반환 (학생 포함). */
    public ClassroomRole requireMember(Long classroomId, Long userId) {
        return role(classroomId, userId);
    }

    private ClassroomRole role(Long classroomId, Long userId) {
        return memberRepository.findByClassroomIdAndUserId(classroomId, userId)
                .map(ClassroomMember::getRole)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));
    }
}
