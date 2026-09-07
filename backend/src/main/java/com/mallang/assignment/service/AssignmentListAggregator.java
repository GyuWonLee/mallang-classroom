package com.mallang.assignment.service;

import com.mallang.assignment.dto.AssignmentDtos.AssignmentSummaryResponse;
import com.mallang.assignment.entity.Assignment;
import com.mallang.classroom.repository.ClassroomMemberRepository.StudentGradeView;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.ClassroomScoreView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 과제 목록에 붙는 선생님용 학급 집계 (명세 §11.2 #7).
 *
 * <p>없을 때는 배너의 평균 제출률·평균 점수와 카드별 제출률을 얻으려고 과제 수만큼
 * {@code GET /assignments/{id}/submissions} 를 반복해야 했다.</p>
 *
 * <p>학급 제출을 한 번에 가져와 메모리에서 접는다. 과제마다 세면 왕복이 과제 수만큼 늘고,
 * "과제별 최신 시도의 평균"을 SQL 한 방으로 쓰려면 윈도우 함수가 필요한데 학급이 20~30명
 * 규모라 그만한 값이 없다.</p>
 */
@Component
@RequiredArgsConstructor
public class AssignmentListAggregator {

    private final AssignmentTargetResolver targetResolver;
    private final SubmissionRepository submissionRepository;

    public List<AssignmentSummaryResponse> withTeacherAggregates(Long classroomId,
                                                                 List<Assignment> assignments) {
        /*
          분모는 **그 과제를 받는 학생 수**다. 학급 전체를 쓰던 때는 1학년 둘에게만 낸 과제를
          둘 다 냈는데도 카드에 10%(20명 중 2명)로 찍혔다 — 선생님이 안 낸 아이를 찾아
          명단을 뒤지게 만드는 숫자였다.

          명단은 한 번만 받아 과제마다 나눠 쓴다. 과제 수만큼 다시 물으면 목록 화면이
          과제가 늘수록 느려진다.
        */
        List<StudentGradeView> roster = targetResolver.roster(classroomId);

        // (과제, 학생) → 최신 시도. 재제출이 새 행이라 접지 않으면 한 사람이 여러 번 세어진다.
        Map<Long, Map<Long, ClassroomScoreView>> latestByAssignment = new HashMap<>();
        for (ClassroomScoreView view : submissionRepository.findClassroomScores(classroomId)) {
            latestByAssignment
                    .computeIfAbsent(view.getAssignmentId(), k -> new HashMap<>())
                    .merge(view.getStudentId(), view,
                            (older, newer) ->
                                    newer.getAttemptNo() >= older.getAttemptNo() ? newer : older);
        }

        List<AssignmentSummaryResponse> summaries = new ArrayList<>(assignments.size());
        for (Assignment assignment : assignments) {
            Map<Long, ClassroomScoreView> latest =
                    latestByAssignment.getOrDefault(assignment.getId(), Map.of());
            int submitted = latest.size();
            int totalStudents = targetResolver.targets(assignment, roster).size();
            summaries.add(AssignmentSummaryResponse.ofTeacher(
                    assignment,
                    totalStudents,
                    submitted,
                    // 대상이 없으면 비율이 정의되지 않는다. 반대로 아무도 안 낸 건 실제로 0% 다.
                    totalStudents == 0 ? null : submitted * 100 / totalStudents,
                    averageScore(latest.values())));
        }
        return summaries;
    }

    /**
     * 채점된 제출만의 평균. 수동 채점 유형(score = null)은 제출로는 세되 평균에서는 뺀다 —
     * 0으로 세면 학급 평균이 실제보다 낮아진다. 채점된 게 없으면 null (0점과는 다르다).
     */
    private Integer averageScore(Iterable<ClassroomScoreView> latest) {
        int sum = 0;
        int count = 0;
        for (ClassroomScoreView view : latest) {
            if (view.getScore() != null) {
                sum += view.getScore();
                count++;
            }
        }
        return count == 0 ? null : sum / count;
    }
}
