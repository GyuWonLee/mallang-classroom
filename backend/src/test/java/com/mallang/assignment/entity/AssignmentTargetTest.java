package com.mallang.assignment.entity;

import com.mallang.assignment.entity.Assignment.Targets;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 공개 대상 판정(isVisibleTo) — 열람·제출 접근 제어가 이걸 쓴다. 규칙을 못 박아둔다.
 * 학년·학생 대상이 둘 다 비면 학급 전체, 지정되면 학생의 학년이 대상 학년이거나 본인이 대상 학생일 때(합집합).
 */
class AssignmentTargetTest {

    private Assignment assignment(Targets targets) {
        return Assignment.create(null, null, "받아쓰기", Subject.KOREAN, 1,
                AssignmentType.DICTATION, AssignmentSource.MANUAL, "{\"problems\":[]}", null, null,
                targets);
    }

    @Test
    void emptyTargetsVisibleToEveryone() {
        Assignment a = assignment(Targets.none());
        assertThat(a.isVisibleTo(1L, (short) 1)).isTrue();
        assertThat(a.isVisibleTo(999L, (short) 3)).isTrue();
    }

    @Test
    void targetedByStudentVisibleOnlyToThoseStudents() {
        Assignment a = assignment(new Targets(Set.of(), Set.of(1L, 2L)));
        assertThat(a.isVisibleTo(1L, (short) 1)).isTrue();
        assertThat(a.isVisibleTo(3L, (short) 1)).isFalse(); // 같은 학년이어도 대상 학생 아님
    }

    @Test
    void targetedByGradeVisibleToThatGrade() {
        // 복식학급: 1학년에게만 공개
        Assignment a = assignment(new Targets(Set.of((short) 1), Set.of()));
        assertThat(a.isVisibleTo(10L, (short) 1)).isTrue();  // 1학년
        assertThat(a.isVisibleTo(11L, (short) 3)).isFalse(); // 3학년은 안 보임
    }

    @Test
    void gradeAndStudentTargetsAreUnion() {
        // 1학년 전체 + 특정 3학년 학생(42) 에게 공개
        Assignment a = assignment(new Targets(Set.of((short) 1), Set.of(42L)));
        assertThat(a.isVisibleTo(10L, (short) 1)).isTrue();  // 1학년
        assertThat(a.isVisibleTo(42L, (short) 3)).isTrue();  // 대상 학생
        assertThat(a.isVisibleTo(99L, (short) 3)).isFalse(); // 3학년이지만 대상 학생 아님
    }
}
