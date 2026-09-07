package com.mallang.chat.service;

import com.mallang.chat.dto.ChatDtos.MessageResponse;
import com.mallang.chat.repository.ChatMessageRepository;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 채팅 이력 조회 (명세 §6 REST) — 조회 권한: "학급의 모든 선생님 + 본인".
 * 실시간 전달과 달리 종료된 수업의 이력도 조회 가능 (기록은 영구).
 */
@Service
@RequiredArgsConstructor
public class ChatQueryService {

    private final ChatMessageRepository chatMessageRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final ClassroomMemberRepository classroomMemberRepository;

    /** 수업 내 메시지 목록 (선생님 전용, studentId 필터 선택) */
    @Transactional(readOnly = true)
    public List<MessageResponse> sessionMessages(Long sessionId, Long studentId, AuthUser authUser) {
        LiveSession session = requireSession(sessionId);
        requireTeacherOf(session, authUser);
        var messages = studentId == null
                ? chatMessageRepository.findAllBySession(sessionId)
                : chatMessageRepository.findThread(sessionId, studentId);
        return messages.stream().map(MessageResponse::from).toList();
    }

    /** 특정 학생과의 대화 스레드 (선생님 or 그 학생 본인) */
    @Transactional(readOnly = true)
    public List<MessageResponse> thread(Long sessionId, Long studentId, AuthUser authUser) {
        LiveSession session = requireSession(sessionId);
        if (!authUser.id().equals(studentId)) {
            requireTeacherOf(session, authUser);
        }
        return chatMessageRepository.findThread(sessionId, studentId).stream()
                .map(MessageResponse::from).toList();
    }

    /** 내가 보낸 메시지와 답장 (학생 전용) */
    @Transactional(readOnly = true)
    public List<MessageResponse> myMessages(AuthUser authUser) {
        if (authUser.isTeacher()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "students-only",
                    "학생 전용 조회입니다 (선생님은 수업별 목록을 사용하세요)");
        }
        return chatMessageRepository.findAllInvolving(authUser.id()).stream()
                .map(MessageResponse::from).toList();
    }

    private LiveSession requireSession(Long sessionId) {
        return liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "session-not-found",
                        "존재하지 않는 수업입니다"));
    }

    /**
     * 이 수업의 대화를 볼 수 있는 사람 — <b>그 수업을 연 선생님만</b>이다.
     *
     * <p>예전에는 학급의 OWNER/MAINTAINER 면 누구나 볼 수 있었다. 그래서 수업을 하지 않는
     * 동료 선생님의 채팅 화면에도 아이들 질문이 쌓였다 — 실시간 배달은 배정된 선생님
     * 한 명에게만 가므로(ChatRouterService) 그 선생님만 새로 고쳐야 보이는, 어중간한
     * 상태이기도 했다.</p>
     *
     * <p>수업 중 질문은 그 수업을 맡은 선생님과 아이 사이의 대화다. 옆 학년 수업을 하는
     * 선생님이 남의 반 아이 질문을 들여다볼 이유가 없다 — 수업에 들어가는 것 자체가
     * 이미 시작한 사람만 되는데(S15P11A407-147) 대화만 열려 있던 셈이다.</p>
     */
    private void requireTeacherOf(LiveSession session, AuthUser authUser) {
        var member = classroomMemberRepository
                .findByClassroomIdAndUserId(session.getClassroom().getId(), authUser.id())
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "학급 구성원이 아닙니다"));
        if (!member.getRole().canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "teachers-only",
                    "선생님만 조회할 수 있습니다");
        }
        if (!session.getStartedBy().getId().equals(authUser.id())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "not-session-teacher",
                    "이 수업을 진행하는 선생님만 볼 수 있습니다");
        }
    }
}
