package com.mallang.report.service;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ActivityDtos.ActivityItem;
import com.mallang.report.dto.ActivityDtos.ActivityType;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.session.repository.SessionHistoryView;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.FeedSubmissionView;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Limit;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 학급 활동 피드 (명세 §11.3 #10) — 선생님 4 화면의 '오늘의 활동'.
 *
 * <p><b>새 표를 만들지 않는다.</b> 피드에 뜰 사건(수업 시작·종료, 과제 공개, 제출, 학생 합류)은
 * 이미 각자의 표에 시각과 함께 남아 있다. 별도 activity 표를 두면 모든 쓰기 경로에 기록을
 * 끼워 넣어야 하고, 빠뜨린 곳이 생기면 피드만 조용히 틀린다. 파생하면 원본이 지워질 때
 * 피드도 자연히 맞는다.</p>
 *
 * <p>대가는 출처마다 조회가 나가고 합치는 일이 여기 있다는 것 — 학급 하나짜리 화면이라
 * 감당할 만하다.</p>
 */
@Service
@RequiredArgsConstructor
public class ActivityFeedService {

    /** 피드 기본 개수. 화면이 스크롤 없이 훑는 자리라 크게 잡을 이유가 없다. */
    public static final int DEFAULT_LIMIT = 20;

    private final AssignmentAccessGuard accessGuard;
    private final LiveSessionRepository liveSessionRepository;
    private final AssignmentRepository assignmentRepository;
    private final SubmissionRepository submissionRepository;
    private final ClassroomMemberRepository memberRepository;

    @Transactional(readOnly = true)
    public List<ActivityItem> feed(AuthUser viewer, Long classroomId, int limit) {
        requireTeacher(viewer, classroomId);
        int size = limit <= 0 ? DEFAULT_LIMIT : limit;

        List<ActivityItem> items = new ArrayList<>();
        addSessions(classroomId, items);
        addPublishedAssignments(classroomId, items);
        addSubmissions(classroomId, size, items);
        addJoinedStudents(classroomId, items);

        items.sort(Comparator.comparing(ActivityItem::at).reversed());
        return items.size() > size ? List.copyOf(items.subList(0, size)) : List.copyOf(items);
    }

    /** 시작과 종료는 서로 다른 사건이다 — 하나로 접으면 타임라인이 틀어진다. */
    private void addSessions(Long classroomId, List<ActivityItem> items) {
        for (SessionHistoryView session : liveSessionRepository.findHistoryByClassroomId(classroomId)) {
            String teacher = session.startedByName();
            items.add(new ActivityItem(ActivityType.SESSION_STARTED, "수업을 시작했어요",
                    teacher, session.sessionId(), session.startedAt()));
            if (session.endedAt() != null) {
                items.add(new ActivityItem(ActivityType.SESSION_ENDED, "수업이 끝났어요",
                        teacher, session.sessionId(), session.endedAt()));
            }
        }
    }

    /** 초안은 학생에게 보이지도 않는다 — 피드에 뜨면 공개된 것처럼 읽힌다. */
    private void addPublishedAssignments(Long classroomId, List<ActivityItem> items) {
        for (Assignment assignment
                : assignmentRepository.findByClassroomIdOrderByCreatedAtDesc(classroomId)) {
            if (assignment.getPublishedAt() == null) {
                continue;
            }
            items.add(new ActivityItem(ActivityType.ASSIGNMENT_PUBLISHED,
                    "과제 '" + assignment.getTitle() + "'를 냈어요",
                    null, assignment.getId(), assignment.getPublishedAt()));
        }
    }

    private void addSubmissions(Long classroomId, int size, List<ActivityItem> items) {
        for (FeedSubmissionView view
                : submissionRepository.findRecentSubmissions(classroomId, Limit.of(size))) {
            items.add(new ActivityItem(ActivityType.SUBMISSION_RECEIVED,
                    "'" + view.getAssignmentTitle() + "'를 냈어요",
                    view.getStudentName(), view.getAssignmentId(), view.getSubmittedAt()));
        }
    }

    /** 선생님이 합류한 것은 학급 운영 소식이 아니므로 학생만 담는다. */
    private void addJoinedStudents(Long classroomId, List<ActivityItem> items) {
        for (ClassroomMember member : memberRepository.findWithUserByClassroomId(classroomId)) {
            if (member.getRole() != ClassroomRole.STUDENT) {
                continue;
            }
            items.add(new ActivityItem(ActivityType.STUDENT_JOINED, "학급에 들어왔어요",
                    member.getUser().getName(), member.getUser().getId(), member.getJoinedAt()));
        }
    }

    private void requireTeacher(AuthUser viewer, Long classroomId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, viewer.id());
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "activity-teacher-only",
                    "학급 선생님만 활동 피드를 볼 수 있습니다.");
        }
    }
}
