package com.mallang.session.controller;

import com.mallang.global.security.AuthUser;
import com.mallang.global.security.StompPrincipals;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import com.mallang.session.service.BoardStrokeService;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.Map;

/**
 * 화이트보드 실시간 채널 — 획 추가/삭제/전체 지우기.
 * SEND: /pub/sessions/{sessionId}/board/strokes · .../strokes/delete · .../clear
 *
 * 저장·권한·소유권 판단은 전부 BoardStrokeService 가 맡는다. 여기서는 인증 주체를 꺼내
 * 위임하고, 성공한 것만 게시판(/sub/sessions/{id})에 방송한다 — 실패하면 예외가 올라가
 * 방송이 나가지 않으므로 화면과 서버 상태가 어긋나지 않는다.
 */
@Controller
@RequiredArgsConstructor
public class BoardController {

    private static final String STROKE_ID = "strokeId";

    private final BoardStrokeService boardStrokeService;
    private final SimpMessagingTemplate messagingTemplate;

    @MessageMapping("/sessions/{sessionId}/board/strokes")
    public void addStroke(@DestinationVariable Long sessionId, Map<String, Object> stroke,
                          Principal principal) {
        AuthUser user = StompPrincipals.authUser(principal);
        // 저장된 형태를 그대로 방송한다 — 서버가 채워 넣은 authorId 를 클라이언트도 같이 보게 된다
        Map<String, Object> stored = boardStrokeService.append(sessionId, stroke, user);
        broadcast(sessionId, StompEventType.BOARD_STROKE,
                Map.of("by", user.id(), "stroke", stored));
    }

    /**
     * 획 하나 삭제 (지우개). 학생은 본인 획만 지울 수 있고, 그 판단은 서비스가 한다.
     */
    @MessageMapping("/sessions/{sessionId}/board/strokes/delete")
    public void deleteStroke(@DestinationVariable Long sessionId, Map<String, Object> payload,
                             Principal principal) {
        AuthUser user = StompPrincipals.authUser(principal);
        Object strokeId = payload.get(STROKE_ID);
        if (!(strokeId instanceof String id) || id.isBlank()) {
            throw new IllegalArgumentException("strokeId 가 필요합니다");
        }
        boardStrokeService.deleteStroke(sessionId, id, user);
        broadcast(sessionId, StompEventType.BOARD_STROKE_DELETED,
                Map.of("strokeId", id, "by", user.id()));
    }

    /**
     * 전체 지우기 — 교사 전용 (서비스의 requireTeacher). 판서 권한만 있는 학생이
     * 남의 풀이를 통째로 날리는 사고를 막는다.
     */
    @MessageMapping("/sessions/{sessionId}/board/clear")
    public void clearBoard(@DestinationVariable Long sessionId, Principal principal) {
        AuthUser user = StompPrincipals.authUser(principal);
        boardStrokeService.clear(sessionId, user);
        broadcast(sessionId, StompEventType.BOARD_CLEAR, Map.of("by", user.id()));
    }

    private void broadcast(Long sessionId, String type, Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/sub/sessions/" + sessionId,
                StompEnvelope.of(type, payload));
    }
}
