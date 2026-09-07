package com.mallang.session.service;

import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 현재 진행 중인 수업을 실제로 시작한 선생님인지 DB에서 검증한다. */
@Service
@RequiredArgsConstructor
public class SessionStarterGuard {

    private final LiveSessionRepository liveSessionRepository;

    @Transactional(readOnly = true)
    public void requireStarter(Long sessionId, AuthUser authUser) {
        LiveSession session = requireOpenSession(sessionId);
        requireStarter(session, authUser);
    }

    /** 현재 수업 시작 선생님인지와 요청 학년이 해당 학급 학년인지 함께 검증한다. */
    @Transactional(readOnly = true)
    public void requireStarterForGrade(Long sessionId, int grade, AuthUser authUser) {
        LiveSession session = requireOpenSession(sessionId);
        requireStarter(session, authUser);

        if (grade < 1 || grade > 6) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-grade",
                    "학년은 1~6 사이여야 합니다");
        }
        if (!session.getClassroom().accepts((short) grade)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "grade-not-in-classroom",
                    "해당 학급에 포함되지 않은 학년입니다");
        }
    }

    private LiveSession requireOpenSession(Long sessionId) {
        return liveSessionRepository.findByIdAndEndedAtIsNull(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-open",
                        "진행 중인 수업이 아닙니다"));
    }

    private void requireStarter(LiveSession session, AuthUser authUser) {
        if (!authUser.isTeacher()
                || session.getStartedBy() == null
                || !session.getStartedBy().getId().equals(authUser.id())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-session-teacher",
                    "현재 수업을 시작한 선생님만 할 수 있습니다");
        }
    }
}
