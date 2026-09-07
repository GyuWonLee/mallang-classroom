package com.mallang.classroom.service;

import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * 담당자 이양 — S15P11A407-137
 *
 * <p>명세가 경로만 예약해 두고 404 였다(§11.4). 학급을 만든 선생님이 학교를 옮기거나 담임이
 * 바뀌면 학급을 통째로 다시 만드는 것 말고는 길이 없었고, 담당자는 학급을 나갈 수도 없다.</p>
 *
 * <p>핵심은 두 역할이 한 번에 바뀌어야 한다는 것 — 넘긴 쪽이 OWNER 로 남으면 담당자가 둘이 되고,
 * 받는 쪽이 안 바뀌면 담당자가 없어진다.</p>
 */
@ExtendWith(MockitoExtension.class)
class ClassroomOwnerTransferTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long OWNER_ID = 1L;
    private static final Long MAINTAINER_ID = 2L;

    @Mock ClassroomRepository classroomRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @InjectMocks ClassroomService service;

    @Test
    void ownerHandsOverAndBecomesMaintainer() {
        ClassroomMember owner = member(ClassroomRole.OWNER);
        ClassroomMember successor = member(ClassroomRole.MAINTAINER);
        found(OWNER_ID, owner);
        found(MAINTAINER_ID, successor);

        service.transferOwner(owner(), CLASSROOM_ID, MAINTAINER_ID);

        // 둘 다 바뀌어야 한다 — 한쪽만 바뀌면 담당자가 둘이거나 없어진다
        assertThat(successor.getRole()).isEqualTo(ClassroomRole.OWNER);
        assertThat(owner.getRole()).isEqualTo(ClassroomRole.MAINTAINER);
    }

    @Test
    void onlyTheCurrentOwnerCanHandOver() {
        found(MAINTAINER_ID, member(ClassroomRole.MAINTAINER));

        assertThatThrownBy(() -> service.transferOwner(
                new AuthUser(MAINTAINER_ID, Role.TEACHER, "부담임"), CLASSROOM_ID, 3L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("담당자");
    }

    @Test
    void cannotHandOverToAStudent() {
        found(OWNER_ID, member(ClassroomRole.OWNER));
        found(MAINTAINER_ID, member(ClassroomRole.STUDENT));

        // 학생이 학급 담당자가 되면 학급 관리 권한이 통째로 넘어간다
        assertThatThrownBy(() -> service.transferOwner(owner(), CLASSROOM_ID, MAINTAINER_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("선생님");
    }

    @Test
    void cannotHandOverToSomeoneOutsideTheClassroom() {
        found(OWNER_ID, member(ClassroomRole.OWNER));
        when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, 99L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.transferOwner(owner(), CLASSROOM_ID, 99L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원");
    }

    @Test
    void handingOverToYourselfIsRejected() {
        found(OWNER_ID, member(ClassroomRole.OWNER));

        assertThatThrownBy(() -> service.transferOwner(owner(), CLASSROOM_ID, OWNER_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이미");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private void found(Long userId, ClassroomMember member) {
        Optional<ClassroomMember> result = Optional.of(member);
        lenient().when(memberRepository.findByClassroomIdAndUserId(CLASSROOM_ID, userId))
                .thenReturn(result);
    }

    /** 역할이 실제로 바뀌는지 봐야 하므로 목이 아니라 진짜 엔티티를 쓴다. */
    private ClassroomMember member(ClassroomRole role) {
        return ClassroomMember.join(null, null, role);
    }

    private AuthUser owner() {
        return new AuthUser(OWNER_ID, Role.TEACHER, "담임");
    }
}
