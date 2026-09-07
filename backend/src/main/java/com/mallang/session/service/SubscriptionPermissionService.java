package com.mallang.session.service;

import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** SUBSCRIBE 검문에서 호출 — "자기 세션/팀만" 규칙의 DB 검증부 */
@Service
@RequiredArgsConstructor
public class SubscriptionPermissionService {

    private final LiveSessionRepository liveSessionRepository;
    private final ClassroomMemberRepository classroomMemberRepository;

    @Transactional(readOnly = true)
    public void checkSessionAccess(Long sessionId, AuthUser user) {
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new AccessDeniedException("존재하지 않는 수업입니다"));
        classroomMemberRepository
                .findByClassroomIdAndUserId(session.getClassroom().getId(), user.id())
                .orElseThrow(() -> new AccessDeniedException("이 수업의 학급 구성원이 아닙니다"));
        if (user.isTeacher()
                && (session.getStartedBy() == null
                || !session.getStartedBy().getId().equals(user.id()))) {
            throw new AccessDeniedException("현재 수업을 시작한 선생님만 구독할 수 있습니다");
        }
    }

    @Transactional(readOnly = true)
    public void checkTeamAccess(Long sessionId, Long teamId, AuthUser user) {
        checkSessionAccess(sessionId, user);
        // TODO: B묶음(팀 도메인) 머지 후 — 학생이면 team_member 소속까지 검증.
        //       현재는 학급 구성원 검증까지만 수행 (교사는 이것으로 충분).
    }
}
