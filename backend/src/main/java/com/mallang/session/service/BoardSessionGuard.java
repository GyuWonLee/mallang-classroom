package com.mallang.session.service;

import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 화이트보드 명령을 보낸 사용자가 현재 수업의 실제 학급 구성원인지 검증한다. */
@Service
@RequiredArgsConstructor
public class BoardSessionGuard {

    private final LiveSessionRepository liveSessionRepository;
    private final ClassroomMemberRepository classroomMemberRepository;
    private final StringRedisTemplate redis;

    @Transactional(readOnly = true)
    public void requireMember(Long sessionId, AuthUser authUser) {
        if (authUser.isTeacher()) {
            LiveSession session = openSession(sessionId);
            requireSessionTeacher(session, authUser);
            requireClassroomMember(session, authUser);
            return;
        }

        String key = SessionRedisKeys.boardMembers(sessionId);
        String userId = String.valueOf(authUser.id());
        if (Boolean.TRUE.equals(redis.opsForSet().isMember(key, userId))) {
            return;
        }

        LiveSession session = openSession(sessionId);
        requireClassroomMember(session, authUser);
        redis.opsForSet().add(key, userId);
    }

    @Transactional(readOnly = true)
    public void requireTeacher(Long sessionId, AuthUser authUser) {
        if (!authUser.isTeacher()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "teacher-only",
                    "선생님만 전체 판서를 지울 수 있습니다");
        }
        requireMember(sessionId, authUser);
    }

    private LiveSession openSession(Long sessionId) {
        return liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-open",
                        "진행 중인 수업이 아닙니다"));
    }

    private void requireClassroomMember(LiveSession session, AuthUser authUser) {
        classroomMemberRepository
                .findByClassroomIdAndUserId(session.getClassroom().getId(), authUser.id())
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "이 수업의 학급 구성원이 아닙니다"));
    }

    private void requireSessionTeacher(LiveSession session, AuthUser authUser) {
        if (session.getStartedBy() == null
                || !session.getStartedBy().getId().equals(authUser.id())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-session-teacher",
                    "현재 수업을 시작한 선생님만 판서할 수 있습니다");
        }
    }
}
