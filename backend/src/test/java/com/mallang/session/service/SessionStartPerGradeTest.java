package com.mallang.session.service;

import tools.jackson.databind.ObjectMapper;
import com.mallang.chat.service.ChatRouterService;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.SessionStartNotifier;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 한 학급에서 학년별로 수업을 따로 여는 규칙 (V31).
 *
 * <p>복식학급에서 1학년은 A 선생님이, 3학년은 B 선생님이 동시에 진행하려는 것이다.
 * 예전에는 학급당 하나만 열려서 두 번째 선생님이 409 를 맞았다.</p>
 */
@ExtendWith(MockitoExtension.class)
class SessionStartPerGradeTest {

    private static final Long CLASSROOM = 7L;

    @Mock LiveSessionRepository liveSessionRepository;
    @Mock SessionParticipantRepository sessionParticipantRepository;
    @Mock ClassroomMemberRepository classroomMemberRepository;
    @Mock TeamMemberRepository teamMemberRepository;
    @Mock UserRepository userRepository;
    @Mock ChatRouterService chatRouterService;
    @Mock SessionStartNotifier sessionStartNotifier;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock StringRedisTemplate redis;
    @Mock LiveKitRoomService liveKitRoomService;
    @Mock SessionTopicService sessionTopicService;

    private SessionService service;

    @BeforeEach
    void setUp() {
        service = new SessionService(liveSessionRepository, sessionParticipantRepository,
                classroomMemberRepository, teamMemberRepository, userRepository, chatRouterService,
                sessionStartNotifier, messagingTemplate, redis, new ObjectMapper(),
                liveKitRoomService, sessionTopicService);
    }

    @Test
    void twoGradesRunSideBySideInOneClassroom() {
        managerOf(CLASSROOM, 2L);
        // 1학년 수업이 이미 돌고 있다
        // mock 은 스터빙 밖에서 먼저 만든다 — thenReturn 인자 안에서 만들면 스터빙이 겹쳐 터진다
        LiveSession open = openSession((short) 1);
        when(liveSessionRepository.findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(CLASSROOM))
                .thenReturn(List.of(open));
        when(liveSessionRepository.save(any(LiveSession.class)))
                .thenAnswer(call -> call.getArgument(0));

        // 다른 선생님이 3학년 수업을 연다 — 막히면 안 된다
        assertThatCode(() -> service.start(CLASSROOM, (short) 3, teacher(2L)))
                .doesNotThrowAnyException();

        ArgumentCaptor<LiveSession> saved = ArgumentCaptor.forClass(LiveSession.class);
        verify(liveSessionRepository).save(saved.capture());
        assertThat(saved.getValue().getGrade()).isEqualTo((short) 3);
    }

    @Test
    void theSameGradeCannotBeOpenedTwice() {
        managerOf(CLASSROOM, 2L);
        // mock 은 스터빙 밖에서 먼저 만든다 — thenReturn 인자 안에서 만들면 스터빙이 겹쳐 터진다
        LiveSession open = openSession((short) 1);
        when(liveSessionRepository.findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(CLASSROOM))
                .thenReturn(List.of(open));

        assertThatThrownBy(() -> service.start(CLASSROOM, (short) 1, teacher(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이미 진행 중인 수업");
    }

    /**
     * 학년 없는 수업 = 학급 전체 수업이다(V31 이전에 만들어진 수업이 그렇다).
     * 그 수업이 열려 있으면 학년 수업을 새로 열 수 없다 — 이미 학급 전체를 보고 있다.
     */
    @Test
    void aWholeClassSessionBlocksEveryGrade() {
        managerOf(CLASSROOM, 2L);
        // mock 은 스터빙 밖에서 먼저 만든다 — thenReturn 인자 안에서 만들면 스터빙이 겹쳐 터진다
        LiveSession open = openSession(null);
        when(liveSessionRepository.findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(CLASSROOM))
                .thenReturn(List.of(open));

        assertThatThrownBy(() -> service.start(CLASSROOM, (short) 3, teacher(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이미 진행 중인 수업");
    }

    /** 반대 방향도 막는다 — 학년 수업이 하나라도 돌면 학급 전체 수업을 열 수 없다. */
    @Test
    void aGradeSessionBlocksTheWholeClassSession() {
        managerOf(CLASSROOM, 2L);
        // mock 은 스터빙 밖에서 먼저 만든다 — thenReturn 인자 안에서 만들면 스터빙이 겹쳐 터진다
        LiveSession open = openSession((short) 1);
        when(liveSessionRepository.findAllByClassroomIdAndEndedAtIsNullOrderByGradeAsc(CLASSROOM))
                .thenReturn(List.of(open));

        assertThatThrownBy(() -> service.start(CLASSROOM, null, teacher(2L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("이미 진행 중인 수업");
    }

    /** 학급이 맡지 않는 학년으로는 열 수 없다 — 팀 배정과 학생 조회가 그 학년을 모른다. */
    @Test
    void aGradeTheClassroomDoesNotTeachIsRejected() {
        managerOf(CLASSROOM, 1L);

        assertThatThrownBy(() -> service.start(CLASSROOM, (short) 6, teacher(1L)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("맡지 않는 학년");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    /** 담당 학년이 1·3인 복식학급의 관리자로 만든다 */
    private void managerOf(Long classroomId, Long userId) {
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getGrades()).thenReturn(new LinkedHashSet<>(List.of((short) 1, (short) 3)));
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(ClassroomRole.OWNER);
        lenient().when(member.getClassroom()).thenReturn(classroom);
        when(classroomMemberRepository.findByClassroomIdAndUserId(classroomId, userId))
                .thenReturn(Optional.of(member));
        lenient().when(userRepository.getReferenceById(userId)).thenReturn(mock(User.class));
    }

    /** Mockito 는 Short 기본값으로 0 을 주므로 학년은 늘 명시한다 */
    private LiveSession openSession(Short grade) {
        LiveSession session = mock(LiveSession.class);
        lenient().when(session.getGrade()).thenReturn(grade);
        return session;
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }
}
