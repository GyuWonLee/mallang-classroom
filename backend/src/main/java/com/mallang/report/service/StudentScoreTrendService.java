package com.mallang.report.service;

import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ScoreTrendDtos.ScoreTrendPoint;
import com.mallang.report.dto.ScoreTrendDtos.ScoreTrendResponse;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.ScoreTrendView;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 학생별 과제 점수 추이 (명세 §11.4).
 *
 * <p>report 는 개념별 집계만 담고 제출 이력이 없어 선생님이 "이 학생이 나아지고 있나"를
 * 볼 수 없었다. 학생 본인은 /me/submissions 로 보는데 선생님 경로만 비어 있었다.</p>
 */
@Service
@RequiredArgsConstructor
public class StudentScoreTrendService {

    private final AssignmentAccessGuard accessGuard;
    private final SubmissionRepository submissionRepository;

    @Transactional(readOnly = true)
    public ScoreTrendResponse trend(AuthUser viewer, Long classroomId, Long studentId) {
        requireAccess(viewer, classroomId, studentId);

        // 재제출이 새 행이므로 과제별 최신 시도만 남긴다 — 안 그러면 옛 점수가 추이를 끌어내린다.
        // 쿼리가 제출 시각 오름차순이라 나중 것이 앞을 덮어쓰고, 삽입 순서도 그대로 유지된다.
        Map<Long, ScoreTrendView> latest = new LinkedHashMap<>();
        for (ScoreTrendView view : submissionRepository.findScoreTrend(classroomId, studentId)) {
            latest.merge(view.getAssignmentId(), view,
                    (older, newer) -> newer.getAttemptNo() >= older.getAttemptNo() ? newer : older);
        }

        List<ScoreTrendPoint> points = latest.values().stream()
                .map(v -> new ScoreTrendPoint(v.getAssignmentId(), v.getTitle(), v.getSubject(),
                        v.getType(), v.getScore(), v.getAttemptNo(), v.getSubmittedAt()))
                .toList();

        return new ScoreTrendResponse(studentId, averageScore(points), points);
    }

    /**
     * 채점된 제출만의 평균. 수동 채점 유형(score = null)을 0으로 세면 평균이 실제보다 낮아져
     * 학생이 못하는 것처럼 보인다. 채점된 게 하나도 없으면 null — 0점과 "아직 없음"은 다르다.
     */
    private Integer averageScore(List<ScoreTrendPoint> points) {
        List<Short> scored = points.stream().map(ScoreTrendPoint::score).filter(s -> s != null)
                .toList();
        if (scored.isEmpty()) {
            return null;
        }
        int sum = scored.stream().mapToInt(Short::intValue).sum();
        return sum / scored.size();
    }

    /** 리포트와 같은 기준 — 학급 선생님 또는 본인. */
    private void requireAccess(AuthUser viewer, Long classroomId, Long studentId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, viewer.id());
        if (!role.canManage() && !viewer.id().equals(studentId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "score-trend-forbidden",
                    "본인 또는 학급 선생님만 점수 추이를 볼 수 있습니다.");
        }
    }
}
