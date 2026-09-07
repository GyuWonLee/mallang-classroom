package com.mallang.assignment.service;

import com.mallang.assignment.dto.AssignmentDtos.AssignmentResponse;
import com.mallang.assignment.dto.AssignmentDtos.AssignmentSummaryResponse;
import com.mallang.assignment.dto.AssignmentDtos.CreateAssignmentRequest;
import com.mallang.assignment.dto.AssignmentDtos.UpdateAssignmentRequest;
import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.realtime.AssignmentPublishedNotifier;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.MyScoreView;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AssignmentService {

    private final AssignmentRepository assignmentRepository;
    private final SubmissionRepository submissionRepository;
    private final UserRepository userRepository;
    private final AssignmentAccessGuard accessGuard;
    private final ObjectMapper objectMapper;
    private final AssignmentPublishedNotifier publishedNotifier;
    private final AssignmentListAggregator listAggregator;

    @Transactional
    public AssignmentResponse create(AuthUser authUser, Long classroomId, CreateAssignmentRequest request) {
        Classroom classroom = accessGuard.requireManager(classroomId, authUser.id());
        User teacher = userRepository.getReferenceById(authUser.id());

        Set<Short> targetGrades = toShortSet(request.targetGrades());
        Set<Long> targetStudentIds = toIdSet(request.targetStudentIds());
        // 대상(학년·학생)을 명시하지 않았는데 학년이 있으면 그 학년으로 공개를 한정한다.
        // AI 문제는 학년(필수)만 담겨 저장돼 targetGrades 가 비면 '학급 전체'로 떨어졌고,
        // 그래서 1학년용 문제가 복식학급의 다른 학년에도 보였다. 대상을 명시하면 그대로 존중한다.
        if (targetGrades.isEmpty() && targetStudentIds.isEmpty() && request.grade() != null) {
            targetGrades = Set.of(request.grade().shortValue());
        }

        Assignment assignment = Assignment.create(classroom, teacher, request.title(),
                request.subject(), request.grade(), request.type(), request.sourceOrDefault(),
                writeJson(request.content()), writeIds(request.sourceMaterialIds()), request.dueAt(),
                new Assignment.Targets(targetGrades, targetStudentIds));
        if (Boolean.TRUE.equals(request.publish())) {
            assignment.publish();
        }
        assignmentRepository.save(assignment);
        return toResponse(assignment);
    }

    public List<AssignmentSummaryResponse> list(AuthUser authUser, Long classroomId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, authUser.id());
        if (role.canManage()) {
            // 선생님 카드에는 "몇 명이 냈고 평균이 몇 점인지"가 필요하다 (명세 §11.2 #7).
            // 과제마다 세면 왕복이 과제 수만큼 늘어나므로 학급 단위로 한 번에 접는다.
            return listAggregator.withTeacherAggregates(classroomId,
                    assignmentRepository.findByClassroomIdOrderByCreatedAtDesc(classroomId));
        }

        // 학생: "이미 낸 과제"를 목록에서 구분할 수 있게 제출 여부·점수를 함께 채운다.
        // 내 제출을 학급 단위로 한 번에 가져와 과제 수만큼 쿼리가 늘지 않게 한다.
        // 대상(학년·학생)이 지정된 과제는 그 학생에게만 — 목록 단계에서 걸러 안 보이게 한다.
        Map<Long, Short> myScores = latestScoresByAssignment(classroomId, authUser.id());
        return assignmentRepository
                .findVisibleToStudent(classroomId, authUser.id(), gradeOf(authUser.id())).stream()
                .map(a -> AssignmentSummaryResponse.of(a,
                        myScores.containsKey(a.getId()), myScores.get(a.getId())))
                .toList();
    }

    /**
     * 과제 → 내 최신 시도 점수. 재제출했으면 최신 시도가 "지금 내 점수"다.
     * 점수가 null 인 제출(미채점 유형)도 제출한 것은 사실이라 키는 남긴다 —
     * 그래서 submitted 판정은 containsKey 로 하고 get 은 점수만 본다.
     */
    private Map<Long, Short> latestScoresByAssignment(Long classroomId, Long studentId) {
        Map<Long, MyScoreView> latest = new HashMap<>();
        for (MyScoreView view : submissionRepository.findMyScoresInClassroom(classroomId, studentId)) {
            latest.merge(view.getAssignmentId(), view,
                    (older, newer) -> newer.getAttemptNo() >= older.getAttemptNo() ? newer : older);
        }
        Map<Long, Short> scores = new HashMap<>();
        latest.forEach((assignmentId, view) -> scores.put(assignmentId, view.getScore()));
        return scores;
    }

    public AssignmentResponse get(AuthUser authUser, Long assignmentId) {
        Assignment assignment = findOrThrow(assignmentId);
        ClassroomRole role = accessGuard.requireMember(assignment.getClassroom().getId(), authUser.id());
        if (!role.canManage()) {
            // 학생은 발행된 과제만, 그리고 대상이 지정됐으면 자기가 대상일 때만 열람 가능
            if (!assignment.isPublished()) {
                throw new ApiException(HttpStatus.FORBIDDEN, "assignment-not-published",
                        "아직 공개되지 않은 과제입니다.");
            }
            if (!assignment.isVisibleTo(authUser.id(), gradeOf(authUser.id()))) {
                throw new ApiException(HttpStatus.FORBIDDEN, "assignment-not-assigned",
                        "회원님에게 공개된 과제가 아닙니다.");
            }
        }
        return toResponse(assignment);
    }

    @Transactional
    public AssignmentResponse update(AuthUser authUser, Long assignmentId, UpdateAssignmentRequest request) {
        Assignment assignment = findOrThrow(assignmentId);
        accessGuard.requireManager(assignment.getClassroom().getId(), authUser.id());

        boolean wasPublished = assignment.isPublished();

        if (request.title() != null) {
            assignment.updateTitle(request.title());
        }
        if (request.dueAt() != null) {
            assignment.updateDueAt(request.dueAt());
        }
        // 문제 편집(삭제/추가)은 초안일 때만. 공개된 과제를 바꾸면 이미 푼 학생과 어긋난다 —
        // 먼저 비공개로 내린 뒤 고치게 한다. (아직 공개 전이므로 wasPublished 로 판단)
        if (request.content() != null) {
            if (wasPublished) {
                throw new ApiException(HttpStatus.CONFLICT, "assignment-content-locked",
                        "이미 공개된 과제의 문제는 수정할 수 없습니다. 먼저 비공개로 전환해 주세요.");
            }
            assignment.updateContent(writeJson(request.content()));
        }
        if (request.publish() != null) {
            if (request.publish()) {
                assignment.publish();
            } else {
                assignment.unpublish();
            }
        }

        // 초안 → 공개로 '처음' 전환된 순간에만 학급 전원에게 실시간 통지 (S15P11A407-134).
        // 이미 공개된 과제를 다시 PATCH하거나 비공개로 내릴 때는 보내지 않는다.
        if (!wasPublished && assignment.isPublished()) {
            publishedNotifier.notifyPublished(assignment.getClassroom().getId(), assignment);
        }
        return toResponse(assignment);
    }

    @Transactional
    public void delete(AuthUser authUser, Long assignmentId) {
        Assignment assignment = findOrThrow(assignmentId);
        accessGuard.requireManager(assignment.getClassroom().getId(), authUser.id());
        assignmentRepository.delete(assignment); // @SQLDelete → soft delete
    }

    private Assignment findOrThrow(Long assignmentId) {
        return assignmentRepository.findById(assignmentId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "assignment-not-found",
                        "과제를 찾을 수 없습니다."));
    }

    private AssignmentResponse toResponse(Assignment assignment) {
        return AssignmentResponse.of(assignment, readJson(assignment.getContent()),
                readIds(assignment.getSourceMaterialIds()));
    }

    /** 요청의 대상 학생 목록 → 집합(중복·null 제거). 비거나 null이면 빈 집합(=제한 없음). */
    private Set<Long> toIdSet(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return Set.of();
        }
        Set<Long> out = new LinkedHashSet<>();
        for (Long id : ids) {
            if (id != null) {
                out.add(id);
            }
        }
        return out;
    }

    /** 요청의 대상 학년 목록 → 집합(중복·null 제거). 비거나 null이면 빈 집합(=학년 제한 없음). */
    private Set<Short> toShortSet(List<Short> grades) {
        if (grades == null || grades.isEmpty()) {
            return Set.of();
        }
        Set<Short> out = new LinkedHashSet<>();
        for (Short g : grades) {
            if (g != null) {
                out.add(g);
            }
        }
        return out;
    }

    /** 학생의 학년 — 대상 학년 판정에 쓴다(선생님은 null이지만 canManage 로 이미 통과한다). */
    private Short gradeOf(Long userId) {
        return userRepository.findById(userId).map(User::getGrade).orElse(null);
    }

    // --- JSON 직렬화/역직렬화 헬퍼 ---

    private String writeJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JacksonException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-content",
                    "문제 데이터를 직렬화할 수 없습니다.");
        }
    }

    private String writeIds(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return null;
        }
        return writeJson(objectMapper.valueToTree(ids));
    }

    private JsonNode readJson(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (JacksonException e) {
            throw new IllegalStateException("저장된 문제 데이터를 해석할 수 없습니다.", e);
        }
    }

    private List<String> readIds(String json) {
        if (json == null) {
            return null;
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (JacksonException e) {
            throw new IllegalStateException("저장된 근거 자료 ID를 해석할 수 없습니다.", e);
        }
    }
}
