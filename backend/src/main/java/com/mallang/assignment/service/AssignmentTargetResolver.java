package com.mallang.assignment.service;

import com.mallang.assignment.entity.Assignment;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomMemberRepository.StudentGradeView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 이 과제를 <b>받는 학생</b>이 누구인지 푼다.
 *
 * <p>판정 규칙 자체는 {@link Assignment#isVisibleTo(Long, Short)} 에 있다 — 대상 학년·대상
 * 학생이 둘 다 비면 학급 전체, 지정돼 있으면 그 합집합이다. 학생 본인의 과제 목록은 오래전부터
 * 이 규칙을 썼는데, <b>선생님용 집계 두 곳이 쓰지 않고 학급 전체를 세고 있었다.</b> 그래서
 * 1학년 두 명에게만 낸 과제인데 학생별 현황에 전교생이 뜨고, 미제출 명단에 대상이 아닌 아이가
 * 잡히고, 제출률 분모가 학급 전체가 됐다(2명 중 2명이 낸 과제가 20명 중 2명 = 10% 로 보였다).</p>
 *
 * <p>규칙을 여기로 옮기지 않고 엔티티의 것을 그대로 부른다. 같은 판정이 두 벌이 되면 반드시
 * 어긋나고, 어긋나는 순간 "학생에게는 보이는데 선생님 현황에는 없는" 학생이 생긴다.</p>
 */
@Component
@RequiredArgsConstructor
public class AssignmentTargetResolver {

    private final ClassroomMemberRepository memberRepository;

    /**
     * 학급의 학생 명단(학년 포함). 과제가 여러 개면 이걸 한 번만 받아
     * {@link #targets(Assignment, List)} 에 나눠 준다 — 과제마다 다시 물으면 왕복이 과제 수만큼 는다.
     */
    public List<StudentGradeView> roster(Long classroomId) {
        return memberRepository.findStudentGrades(classroomId, ClassroomRole.STUDENT);
    }

    /** 명단에서 이 과제의 대상만 골라 낸다. */
    public List<Long> targets(Assignment assignment, List<StudentGradeView> roster) {
        return roster.stream()
                .filter(view -> assignment.isVisibleTo(view.getStudentId(), view.getGrade()))
                .map(StudentGradeView::getStudentId)
                .toList();
    }

    /** 과제 한 건만 볼 때. */
    public List<Long> targets(Long classroomId, Assignment assignment) {
        return targets(assignment, roster(classroomId));
    }
}
