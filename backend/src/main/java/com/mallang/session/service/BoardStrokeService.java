package com.mallang.session.service;

import com.mallang.global.security.AuthUser;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 화이트보드 획 저장과 개별 삭제 권한을 관리한다.
 * 작성자는 클라이언트 값이 아니라 인증 사용자로 덮어써서 위조를 막는다.
 */
@Service
@RequiredArgsConstructor
public class BoardStrokeService {

    private static final String STROKE_ID = "strokeId";
    private static final String AUTHOR_ID = "authorId";
    private static final String TOOL = "tool";
    private static final String PEN = "pen";
    private static final String ERASER = "eraser";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final BoardSessionGuard boardSessionGuard;

    public Map<String, Object> append(Long sessionId, Map<String, Object> stroke, AuthUser user) {
        boardSessionGuard.requireMember(sessionId, user);
        requireBoardWriter(sessionId, user);
        String strokeId = requireStrokeId(stroke);

        // 좌표 기반 지우개는 다른 작성자의 픽셀까지 지울 수 있어 학생에게 허용하지 않는다.
        // 학생 삭제는 deleteStroke()의 strokeId 단위 소유권 검사를 반드시 거친다.
        String tool = String.valueOf(stroke.get(TOOL)).trim();
        if (!PEN.equalsIgnoreCase(tool) && !ERASER.equalsIgnoreCase(tool)) {
            throw new IllegalArgumentException("지원하지 않는 판서 도구입니다");
        }
        if (!user.isTeacher() && ERASER.equalsIgnoreCase(tool)) {
            throw new AccessDeniedException("학생은 본인이 작성한 획만 삭제할 수 있습니다");
        }

        Map<String, Object> stored = new LinkedHashMap<>(stroke);
        stored.put(STROKE_ID, strokeId);
        stored.put(AUTHOR_ID, user.id());

        String raw;
        try {
            raw = objectMapper.writeValueAsString(stored);
        } catch (JacksonException e) {
            throw new IllegalArgumentException("획 데이터를 직렬화할 수 없습니다", e);
        }

        ensureStrokeIndex(sessionId);
        String strokeIdsKey = SessionRedisKeys.boardStrokeIds(sessionId);
        String strokeMapKey = SessionRedisKeys.boardStrokeMap(sessionId);
        Long added = redis.opsForSet().add(strokeIdsKey, strokeId);
        if (added == null) {
            throw new IllegalStateException("획 ID를 저장하지 못했습니다");
        }
        if (added == 0) {
            // 전송 성공 후 응답을 못 받은 동일 요청은 성공으로 취급하되,
            // 삭제된 ID나 내용이 다른 충돌 요청으로 획이 되살아나는 것은 막는다.
            Object existingRaw = redis.opsForHash().get(strokeMapKey, strokeId);
            if (raw.equals(existingRaw)) {
                return stored;
            }
            throw new IllegalArgumentException("이미 사용된 strokeId입니다");
        }

        try {
            redis.opsForHash().put(strokeMapKey, strokeId, raw);
            Long position = redis.opsForList().rightPush(
                    SessionRedisKeys.boardStrokes(sessionId), raw);
            if (position == null) {
                throw new IllegalStateException("획을 저장하지 못했습니다");
            }
        } catch (RuntimeException e) {
            // 부분 저장이 남지 않게 Hash와 ID 예약을 함께 되돌린다.
            redis.opsForHash().delete(strokeMapKey, strokeId);
            redis.opsForSet().remove(strokeIdsKey, strokeId);
            throw e;
        }
        return stored;
    }

    public void deleteStroke(Long sessionId, String strokeId, AuthUser user) {
        boardSessionGuard.requireMember(sessionId, user);
        requireBoardWriter(sessionId, user);
        String normalizedId = requireStrokeId(strokeId);
        ensureStrokeIndex(sessionId);
        String key = SessionRedisKeys.boardStrokes(sessionId);
        String mapKey = SessionRedisKeys.boardStrokeMap(sessionId);
        String raw = asString(redis.opsForHash().get(mapKey, normalizedId));
        if (raw == null) {
            throw new IllegalArgumentException("존재하지 않는 획입니다");
        }

        Map<String, Object> stored = deserializeOrNull(raw);
        if (stored == null || !normalizedId.equals(String.valueOf(stored.get(STROKE_ID)))) {
            throw new IllegalArgumentException("저장된 획 데이터를 읽을 수 없습니다");
        }

        Long authorId = asLong(stored.get(AUTHOR_ID));
        if (!user.isTeacher() && !user.id().equals(authorId)) {
            throw new AccessDeniedException("학생은 본인이 작성한 획만 삭제할 수 있습니다");
        }

        Long removed = redis.opsForList().remove(key, 1, raw);
        if (removed == null || removed == 0) {
            throw new IllegalArgumentException("이미 삭제된 획입니다");
        }
        redis.opsForHash().delete(mapKey, normalizedId);

    }

    public void clear(Long sessionId, AuthUser user) {
        boardSessionGuard.requireTeacher(sessionId, user);
        redis.delete(List.of(
                SessionRedisKeys.boardStrokes(sessionId),
                SessionRedisKeys.boardStrokeIds(sessionId),
                SessionRedisKeys.boardStrokeMap(sessionId)));
        // 빈 보드도 인덱스 구축이 끝난 상태이므로 잘못된 ID 요청이 LIST를 다시 훑지 않게 한다.
        redis.opsForValue().set(SessionRedisKeys.boardStrokeMapReady(sessionId), "true");
    }

    private void requireBoardWriter(Long sessionId, AuthUser user) {
        if (user.isTeacher()) {
            return;
        }
        Boolean granted = redis.opsForSet()
                .isMember(SessionRedisKeys.boardGrants(sessionId), String.valueOf(user.id()));
        if (!Boolean.TRUE.equals(granted)) {
            throw new AccessDeniedException("판서 권한이 없습니다");
        }
    }

    private String requireStrokeId(Map<String, Object> stroke) {
        Object strokeId = stroke.get(STROKE_ID);
        if (!(strokeId instanceof String id)) {
            throw new IllegalArgumentException("strokeId가 필요합니다");
        }
        return requireStrokeId(id);
    }

    private String requireStrokeId(String strokeId) {
        if (strokeId == null || strokeId.isBlank()) {
            throw new IllegalArgumentException("strokeId가 필요합니다");
        }
        return strokeId;
    }

    private Map<String, Object> deserializeOrNull(String raw) {
        try {
            return objectMapper.readValue(raw, new TypeReference<>() {});
        } catch (JacksonException e) {
            // 하나의 손상된 획 때문에 정상 획 삭제까지 막히지 않게 건너뛴다.
            return null;
        }
    }

    private void ensureStrokeIndex(Long sessionId) {
        String readyKey = SessionRedisKeys.boardStrokeMapReady(sessionId);
        if (Boolean.TRUE.equals(redis.hasKey(readyKey))) {
            return;
        }

        String listKey = SessionRedisKeys.boardStrokes(sessionId);
        String mapKey = SessionRedisKeys.boardStrokeMap(sessionId);
        String idsKey = SessionRedisKeys.boardStrokeIds(sessionId);
        List<String> strokes = redis.opsForList().range(listKey, 0, -1);
        if (strokes != null) {
            for (String raw : strokes) {
                Map<String, Object> stored = deserializeOrNull(raw);
                if (stored == null) {
                    continue;
                }
                Object value = stored.get(STROKE_ID);
                if (!(value instanceof String id) || id.isBlank()) {
                    continue;
                }
                redis.opsForHash().putIfAbsent(mapKey, id, raw);
                redis.opsForSet().add(idsKey, id);
            }
        }
        redis.opsForValue().set(readyKey, "true");
    }

    private String asString(Object value) {
        return value instanceof String text ? text : null;
    }

    private Long asLong(Object value) {
        if (value instanceof Number number) {
            return number.longValue();
        }
        if (value instanceof String text) {
            try {
                return Long.valueOf(text);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }
}
