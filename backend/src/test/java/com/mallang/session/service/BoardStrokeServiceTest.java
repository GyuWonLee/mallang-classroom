package com.mallang.session.service;

import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.access.AccessDeniedException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@SuppressWarnings("unchecked")
class BoardStrokeServiceTest {

    private static final Long SESSION_ID = 10L;
    private static final String STROKES_KEY = "session:10:board:strokes";
    private static final String STROKE_IDS_KEY = "session:10:board:stroke-ids";
    private static final String STROKE_MAP_KEY = "session:10:board:stroke-map";
    private static final String STROKE_MAP_READY_KEY = "session:10:board:stroke-map-ready";

    @Mock StringRedisTemplate redis;
    @Mock ListOperations<String, String> listOperations;
    @Mock SetOperations<String, String> setOperations;
    @Mock HashOperations<String, Object, Object> hashOperations;
    @Mock ValueOperations<String, String> valueOperations;
    @Mock ObjectMapper objectMapper;
    @Mock BoardSessionGuard boardSessionGuard;

    private BoardStrokeService service;

    @BeforeEach
    void setUp() {
        service = new BoardStrokeService(redis, objectMapper, boardSessionGuard);
        lenient().when(redis.hasKey(STROKE_MAP_READY_KEY)).thenReturn(true);
        lenient().when(redis.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    void appendingStrokeOverwritesForgedAuthorId() throws Exception {
        allowStudent(11L);
        reserveStrokeId("stroke-1");
        when(redis.opsForList()).thenReturn(listOperations);
        when(objectMapper.writeValueAsString(any())).thenReturn("stored-json");
        when(listOperations.rightPush(STROKES_KEY, "stored-json")).thenReturn(1L);

        Map<String, Object> stored = service.append(SESSION_ID,
                Map.of("strokeId", "stroke-1", "authorId", 999L, "tool", "pen"),
                student(11L));

        assertThat(stored.get("authorId")).isEqualTo(11L);
        verify(hashOperations).put(STROKE_MAP_KEY, "stroke-1", "stored-json");
        verify(listOperations).rightPush(STROKES_KEY, "stored-json");
    }

    @Test
    void duplicateStrokeIdIsRejected() throws Exception {
        when(objectMapper.writeValueAsString(any())).thenReturn("stored-json");
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.add(STROKE_IDS_KEY, "stroke-1")).thenReturn(0L);
        when(redis.opsForHash()).thenReturn(hashOperations);

        assertThatThrownBy(() -> service.append(SESSION_ID,
                Map.of("strokeId", "stroke-1", "tool", "pen"), teacher(1L)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("이미 사용된 strokeId");

        verify(redis, never()).opsForList();
    }

    @Test
    void identicalNetworkRetryIsIdempotent() throws Exception {
        when(objectMapper.writeValueAsString(any())).thenReturn("stored-json");
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.add(STROKE_IDS_KEY, "stroke-1")).thenReturn(0L);
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.get(STROKE_MAP_KEY, "stroke-1")).thenReturn("stored-json");

        Map<String, Object> stored = service.append(SESSION_ID,
                Map.of("strokeId", "stroke-1", "tool", "pen"), teacher(1L));

        assertThat(stored.get("strokeId")).isEqualTo("stroke-1");
        verify(redis, never()).opsForList();
    }

    @Test
    void teacherCanAppendCoordinateEraserStroke() throws Exception {
        reserveStrokeId("eraser-1");
        when(redis.opsForList()).thenReturn(listOperations);
        when(objectMapper.writeValueAsString(any())).thenReturn("stored-json");
        when(listOperations.rightPush(STROKES_KEY, "stored-json")).thenReturn(1L);

        service.append(SESSION_ID,
                Map.of("strokeId", "eraser-1", "tool", "eraser"), teacher(1L));

        verify(listOperations).rightPush(STROKES_KEY, "stored-json");
    }

    @Test
    void missingToolIsRejected() {
        assertThatThrownBy(() -> service.append(SESSION_ID,
                Map.of("strokeId", "stroke-1"), teacher(1L)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("지원하지 않는 판서 도구");
    }

    @Test
    void studentCannotAppendCoordinateEraserStroke() {
        allowStudent(11L);

        assertThatThrownBy(() -> service.append(SESSION_ID,
                Map.of("strokeId", "eraser-1", "tool", "eraser"), student(11L)))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("본인이 작성한 획만");

        verify(redis, never()).opsForList();
    }

    @Test
    void teacherCanDeleteAnyStudentsStroke() throws Exception {
        storedStroke("raw-1", "stroke-1", 11L);
        when(listOperations.remove(STROKES_KEY, 1, "raw-1")).thenReturn(1L);

        service.deleteStroke(SESSION_ID, "stroke-1", teacher(1L));

        verify(listOperations).remove(STROKES_KEY, 1, "raw-1");
    }

    @Test
    void studentCanDeleteOwnStroke() throws Exception {
        allowStudent(11L);
        storedStroke("raw-1", "stroke-1", 11L);
        when(listOperations.remove(STROKES_KEY, 1, "raw-1")).thenReturn(1L);

        service.deleteStroke(SESSION_ID, "stroke-1", student(11L));

        verify(listOperations).remove(STROKES_KEY, 1, "raw-1");
    }

    @Test
    void studentCannotDeleteAnotherStudentsStroke() throws Exception {
        allowStudent(11L);
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.get(STROKE_MAP_KEY, "stroke-1")).thenReturn("raw-1");
        when(objectMapper.readValue(eq("raw-1"), any(TypeReference.class)))
                .thenReturn(Map.of("strokeId", "stroke-1", "authorId", 12L));

        assertThatThrownBy(() -> service.deleteStroke(SESSION_ID, "stroke-1", student(11L)))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("본인이 작성한 획만");

        verify(redis, never()).opsForList();
    }

    @Test
    void studentWithoutBoardGrantCannotDeleteStroke() {
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.isMember(SessionRedisKeys.boardGrants(SESSION_ID), "11"))
                .thenReturn(false);

        assertThatThrownBy(() -> service.deleteStroke(SESSION_ID, "stroke-1", student(11L)))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("판서 권한");
    }

    @Test
    void missingStrokeCannotBeDeleted() {
        when(redis.opsForHash()).thenReturn(hashOperations);

        assertThatThrownBy(() -> service.deleteStroke(SESSION_ID, "missing", teacher(1L)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("존재하지 않는 획");
    }

    @Test
    void alreadyRemovedStrokeReportsConflict() throws Exception {
        storedStroke("raw-1", "stroke-1", 11L);
        when(listOperations.remove(STROKES_KEY, 1, "raw-1")).thenReturn(0L);

        assertThatThrownBy(() -> service.deleteStroke(SESSION_ID, "stroke-1", teacher(1L)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("이미 삭제된 획");
    }

    @Test
    void inconsistentHashEntryCannotBeDeleted() throws Exception {
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.get(STROKE_MAP_KEY, "missing")).thenReturn("raw-1");
        when(objectMapper.readValue(eq("raw-1"), any(TypeReference.class)))
                .thenReturn(Map.of("strokeId", "another-stroke", "authorId", 11L));

        assertThatThrownBy(() -> service.deleteStroke(SESSION_ID, "missing", teacher(1L)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("저장된 획 데이터");
    }

    @Test
    void legacyStrokeWithoutAuthorIdCannotBeDeletedByStudent() throws Exception {
        allowStudent(11L);
        when(redis.hasKey(STROKE_MAP_READY_KEY)).thenReturn(false);
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(redis.opsForList()).thenReturn(listOperations);
        when(listOperations.range(STROKES_KEY, 0, -1)).thenReturn(List.of("legacy-raw"));
        when(objectMapper.readValue(eq("legacy-raw"), any(TypeReference.class)))
                .thenReturn(Map.of("strokeId", "stroke-1"));
        when(hashOperations.get(STROKE_MAP_KEY, "stroke-1")).thenReturn("legacy-raw");

        assertThatThrownBy(() -> service.deleteStroke(SESSION_ID, "stroke-1", student(11L)))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("본인이 작성한 획만");
    }

    @Test
    void teacherClearRemovesStrokesAndIdReservations() {
        service.clear(SESSION_ID, teacher(1L));

        verify(boardSessionGuard).requireTeacher(SESSION_ID, teacher(1L));
        verify(redis).delete(List.of(STROKES_KEY, STROKE_IDS_KEY, STROKE_MAP_KEY));
        verify(valueOperations).set(STROKE_MAP_READY_KEY, "true");
    }

    @Test
    void missingIdDoesNotScanListAfterIndexIsReady() {
        when(redis.opsForHash()).thenReturn(hashOperations);

        assertThatThrownBy(() -> service.deleteStroke(SESSION_ID, "missing", teacher(1L)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("존재하지 않는 획");

        verify(redis, never()).opsForList();
    }

    private void allowStudent(Long userId) {
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.isMember(SessionRedisKeys.boardGrants(SESSION_ID), String.valueOf(userId)))
                .thenReturn(true);
    }

    private void reserveStrokeId(String strokeId) {
        when(redis.opsForSet()).thenReturn(setOperations);
        when(setOperations.add(STROKE_IDS_KEY, strokeId)).thenReturn(1L);
        when(redis.opsForHash()).thenReturn(hashOperations);
    }

    private void storedStroke(String raw, String strokeId, Long authorId) throws Exception {
        when(redis.opsForHash()).thenReturn(hashOperations);
        when(hashOperations.get(STROKE_MAP_KEY, strokeId)).thenReturn(raw);
        when(redis.opsForList()).thenReturn(listOperations);
        when(objectMapper.readValue(eq(raw), any(TypeReference.class)))
                .thenReturn(Map.of("strokeId", strokeId, "authorId", authorId));
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "선생님");
    }

    private AuthUser student(Long id) {
        return new AuthUser(id, Role.STUDENT, "학생");
    }
}
