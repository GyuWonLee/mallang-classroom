package com.mallang.realtime;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.service.AssignmentTargetResolver;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.realtime.dto.StompEnvelope;
import com.mallang.realtime.dto.StompEventType;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 과제 초안→공개 전환 시 학급 구성원 전원의 개인 사물함으로 ASSIGNMENT_PUBLISHED 푸시 (S15P11A407-134).
 * 과제 공개는 수업 세션과 무관하게 일어나므로 세션 토픽이 아니라 개인 알림함(/user/sub/notifications)으로 보낸다.
 * {@link SessionStartNotifier} 를 그대로 본뜸 — payload는 프론트가 목록을 다시 받아올 최소 정보만 담는다.
 */
@Component
@RequiredArgsConstructor
public class AssignmentPublishedNotifier {

    private static final java.util.List<ClassroomRole> TEACHER_ROLES =
            java.util.List.of(ClassroomRole.OWNER, ClassroomRole.MAINTAINER);

    private final ClassroomMemberRepository classroomMemberRepository;
    private final AssignmentTargetResolver targetResolver;
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * 공개 알림을 보낼 사람 — <b>그 과제를 받는 학생</b>과 학급 선생님들.
     *
     * <p>예전에는 학급 구성원 <b>전원</b>에게 보냈다. 과제는 학년·학생을 골라 나가는데
     * (targetGrades·targetStudentIds) 알림만 모두에게 간 것이다. 그래서 1학년 아이가
     * "새 과제가 도착했어요"를 받고 활동지를 열었는데 아무것도 없는 일이 생겼다 —
     * 3학년 과제였기 때문이다. 알림이 거짓말을 하면 다음 알림도 안 믿게 된다.</p>
     *
     * <p>선생님은 대상이 아니어도 받는다. 같은 학급을 맡은 사람에게는 "무엇이 나갔는지"가
     * 그 자체로 정보다.</p>
     */
    public void notifyPublished(Long classroomId, Assignment assignment) {
        java.util.Set<Long> recipients = new java.util.LinkedHashSet<>(
                targetResolver.targets(classroomId, assignment));
        recipients.addAll(classroomMemberRepository
                .findUserIdsByClassroomIdAndRoleIn(classroomId, TEACHER_ROLES));

        for (Long userId : recipients) {
            messagingTemplate.convertAndSendToUser(String.valueOf(userId), "/sub/notifications",
                    StompEnvelope.of(StompEventType.ASSIGNMENT_PUBLISHED,
                            Map.of("classroomId", classroomId,
                                    "assignmentId", assignment.getId())));
        }
    }
}
