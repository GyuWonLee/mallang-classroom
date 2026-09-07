package com.mallang.session.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.dto.AttendanceDtos.AttendanceEntry;
import com.mallang.session.dto.AttendanceDtos.AttendanceResponse;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionHistoryView;
import com.mallang.session.repository.SessionParticipantRepository;
import com.mallang.session.repository.SessionParticipantRepository.AttendanceView;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 학생별 출석 (명세 §11.3).
 *
 * <p>데이터는 LiveKit 웹훅이 SESSION_PARTICIPANT 에 계속 쌓고 있었는데 학생 단위로 꺼내는
 * 길이 없었다. 결석한 수업도 행으로 내려줘야 화면이 "안 온 날"을 그릴 수 있으므로,
 * 학급의 수업 이력을 기준으로 삼고 거기에 참여 기록을 얹는다.</p>
 */
@Service
@RequiredArgsConstructor
public class SessionAttendanceService {

    private final AssignmentAccessGuard accessGuard;
    private final LiveSessionRepository liveSessionRepository;
    private final SessionParticipantRepository sessionParticipantRepository;

    @Transactional(readOnly = true)
    public AttendanceResponse attendance(AuthUser viewer, Long classroomId, Long studentId) {
        requireAccess(viewer, classroomId, studentId);

        Map<Long, List<AttendanceView>> bySession = new LinkedHashMap<>();
        for (AttendanceView view : sessionParticipantRepository
                .findAttendanceByClassroomAndStudent(classroomId, studentId)) {
            bySession.computeIfAbsent(view.getSessionId(), k -> new ArrayList<>()).add(view);
        }

        List<SessionHistoryView> history = liveSessionRepository.findHistoryByClassroomId(classroomId);
        List<AttendanceEntry> entries = new ArrayList<>(history.size());
        int attended = 0;
        for (SessionHistoryView session : history) {
            List<AttendanceView> views = bySession.get(session.sessionId());
            AttendanceEntry entry = toEntry(session, views);
            if (entry.attended()) {
                attended++;
            }
            entries.add(entry);
        }

        // 수업이 없으면 비율은 0 — 분모가 0이라 "출석률"이 정의되지 않는다.
        int rate = history.isEmpty() ? 0 : attended * 100 / history.size();
        return new AttendanceResponse(studentId, history.size(), attended, rate, entries);
    }

    /**
     * 재입장으로 여러 행이 생긴 수업을 하나로 접는다. 체류 시간은 조각의 합이라
     * 끊겨 있던 시간은 빠진다 — "얼마나 있었나"를 묻는 값이기 때문이다.
     */
    private AttendanceEntry toEntry(SessionHistoryView session, List<AttendanceView> views) {
        if (views == null || views.isEmpty()) {
            return new AttendanceEntry(session.sessionId(), session.startedAt(),
                    session.endedAt(), false, null, null, 0);
        }
        LocalDateTime firstJoin = null;
        LocalDateTime lastLeft = null;
        long minutes = 0;
        for (AttendanceView view : views) {
            LocalDateTime joined = view.getJoinedAt();
            if (firstJoin == null || joined.isBefore(firstJoin)) {
                firstJoin = joined;
            }
            LocalDateTime left = view.getLeftAt();
            if (left != null && (lastLeft == null || left.isAfter(lastLeft))) {
                lastLeft = left;
            }
            // leftAt 이 없는 행: 수업이 끝났으면 종료 시각까지, 진행 중이면 지금까지 앉아 있는 것으로 본다.
            LocalDateTime until = left != null ? left
                    : (session.endedAt() != null ? session.endedAt() : LocalDateTime.now());
            if (until.isAfter(joined)) {
                minutes += Duration.between(joined, until).toMinutes();
            }
        }
        return new AttendanceEntry(session.sessionId(), session.startedAt(), session.endedAt(),
                true, firstJoin, lastLeft, (int) minutes);
    }

    /** 리포트와 같은 기준 — 학급 선생님 또는 본인. */
    private void requireAccess(AuthUser viewer, Long classroomId, Long studentId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, viewer.id());
        if (!role.canManage() && !viewer.id().equals(studentId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "attendance-forbidden",
                    "본인 또는 학급 선생님만 출석을 볼 수 있습니다.");
        }
    }
}
