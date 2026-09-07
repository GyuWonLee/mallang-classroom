package com.mallang.submission.service;

import com.mallang.assignment.entity.Assignment;
import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.submission.dto.SubmissionDtos.MySubmissionDetailResponse;
import com.mallang.submission.dto.SubmissionDtos.MySubmissionResponse;
import com.mallang.submission.dto.SubmissionDtos.SubmitRequest;
import com.mallang.submission.dto.SubmissionDtos.SubmitResponse;
import com.mallang.submission.entity.Submission;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.submission.repository.SubmissionRepository.MySubmissionView;
import com.mallang.submission.service.GradingService.GradeResult;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 과제 제출 + 즉시 자동 채점 (명세 §7, 부록 B-5).
 * 발행됐고 마감 전인 과제에만 제출 가능하며, 재제출은 새 시도(attempt_no)로 보존한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubmissionService {

    private final SubmissionRepository submissionRepository;
    private final AssignmentRepository assignmentRepository;
    private final AssignmentAccessGuard accessGuard;
    private final UserRepository userRepository;
    private final GradingService gradingService;
    private final SubmissionFeedbackService feedbackService;
    private final ObjectMapper objectMapper;

    /**
     * 내 제출 목록 — 같은 과제를 여러 번 냈으면 최신 시도만 남긴다.
     * 학생 홈에서 "내가 낸 것들"을 훑는 화면이라 지금 상태(최신 점수)를 보여주는 게 맞다.
     * 아무것도 안 낸 학생은 빈 목록 — 없는 게 정상 상태이므로 404 가 아니다.
     */
    @Transactional(readOnly = true)
    public List<MySubmissionResponse> mySubmissions(AuthUser authUser) {
        Map<Long, MySubmissionView> latest = new LinkedHashMap<>();
        for (MySubmissionView view : submissionRepository.findMineByStudentId(authUser.id())) {
            latest.merge(view.getAssignmentId(), view,
                    (older, newer) -> newer.getAttemptNo() >= older.getAttemptNo() ? newer : older);
        }
        return latest.values().stream()
                .map(v -> new MySubmissionResponse(v.getSubmissionId(), v.getAssignmentId(),
                        v.getTitle(), v.getSubject(), v.getType(), v.getScore(),
                        v.getAttemptNo(), v.getSubmittedAt()))
                .toList();
    }

    /**
     * 내 답안 상세 (최신 시도) — "내가 뭘 틀렸는지" 화면.
     * 본인 제출만 조회한다. 남의 것을 보려면 studentId 를 받는 별도 선생님용 API 가 필요하다.
     *
     * <p>일부러 트랜잭션을 열지 않는다. 총평이 아직 없으면 여기서 LLM 을 부르는데, 그 왕복(수 초) 동안
     * DB 커넥션을 쥐고 있으면 학급 인원이 동시에 이 화면을 열 때 커넥션 풀이 그대로 마른다.
     * 조회(리포지토리 자체 트랜잭션) → LLM(트랜잭션 밖) → 캐시 저장(짧은 트랜잭션) 으로 끊는다.
     * 과제는 조회 때 함께 로딩되므로(@EntityGraph) 트랜잭션 밖에서도 프록시 문제가 없다.</p>
     */
    public MySubmissionDetailResponse mySubmission(AuthUser authUser, Long assignmentId) {
        Submission submission = submissionRepository
                .findFirstByAssignmentIdAndStudentIdOrderByAttemptNoDesc(assignmentId, authUser.id())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "submission-not-found",
                        "아직 제출하지 않은 과제입니다."));

        JsonNode gradedResults = readJsonOrNull(submission.getResults());
        JsonNode answers = readJsonOrNull(submission.getAnswers());
        // 채점 결과(no·correct)에 과제 content(발문·보기·정답)를 no로 합쳐, 프론트가 문제 자체를 그대로 보이게 한다.
        JsonNode results = buildReview(submission.getAssignment(), gradedResults, answers);
        return new MySubmissionDetailResponse(
                submission.getId(),
                assignmentId,
                submission.getAssignment().getTitle(),
                submission.getScore(),
                submission.getAttemptNo(),
                submission.getSubmittedAt(),
                answers,
                results,
                cachedOrNewFeedback(submission, gradedResults));
    }

    /**
     * 과제 전체 AI 총평 — 처음 열 때 한 번 만들어 제출 행에 캐시한다
     * (명세 §8 이 aiAnalysis 에 쓰는 "온디맨드 + 캐시" 와 같은 원칙).
     *
     * <p>조회마다 새로 만들면 ① 학생이 새로고침할 때마다 총평 문구가 바뀌고
     * ② 읽기 한 번당 LLM 비용이 나간다. 둘 다 조회 API 에서 나오면 안 되는 성질이다.</p>
     *
     * <p>캐시 저장이 실패해도 이번 응답은 그대로 내보낸다 — 총평을 못 적었다고 화면을 막는 건 과하다.
     * 다음 조회에서 다시 만들어 저장을 시도한다.</p>
     */
    private String cachedOrNewFeedback(Submission submission, JsonNode gradedResults) {
        if (submission.getFeedback() != null) {
            return submission.getFeedback();
        }
        String feedback = feedbackService.feedback(gradedResults);
        if (feedback == null) {
            return null; // 문항 결과가 없는 제출 — 만들 것도 캐시할 것도 없다
        }
        try {
            submissionRepository.updateFeedback(submission.getId(), feedback);
        } catch (RuntimeException e) {
            log.warn("과제 총평 캐시 저장 실패 — 응답은 그대로 내보낸다. submissionId={}",
                    submission.getId(), e);
        }
        return feedback;
    }

    /**
     * 저장된 JSON 이 깨져 있어도 점수·제출시각은 보여준다 — 화면 전체가 막히는 것보다 낫다.
     * (히트맵도 같은 원칙으로 깨진 제출을 건너뛴다)
     */
    private JsonNode readJsonOrNull(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return objectMapper.readTree(raw);
        } catch (JacksonException e) {
            return null;
        }
    }

    /**
     * '다시 보기'용 문항 목록 — 과제 content(발문·보기·정답)에 채점 결과(correct)와 내가 고른 답(myAnswer)을
     * 문항 번호(no)로 합친다. content가 없거나 깨졌으면 채점 결과(no·correct)만 그대로 돌려준다.
     */
    private JsonNode buildReview(Assignment assignment, JsonNode gradedResults, JsonNode answers) {
        JsonNode content = readJsonOrNull(assignment.getContent());
        if (content == null || !content.path("problems").isArray()) {
            return gradedResults;
        }
        Map<Integer, JsonNode> resultByNo = new LinkedHashMap<>();
        if (gradedResults != null && gradedResults.isArray()) {
            for (JsonNode r : gradedResults) {
                resultByNo.put(r.path("no").asInt(), r);
            }
        }
        ArrayNode out = objectMapper.createArrayNode();
        for (JsonNode p : content.path("problems")) {
            int no = p.path("no").asInt();
            JsonNode graded = resultByNo.get(no);
            ObjectNode item = objectMapper.createObjectNode();
            item.put("no", no);
            setOrNull(item, "prompt", p.get("prompt"));         // 발문/문장
            setOrNull(item, "choices", p.get("choices"));       // 보기 (없으면 null)
            setOrNull(item, "answer", p.get("answer"));         // 정답 인덱스 (없으면 null)
            setOrNull(item, "answerText", p.get("answerText")); // 받아쓰기 정답 (없으면 null)
            setOrNull(item, "myAnswer", answers == null ? null : answers.get(String.valueOf(no)));
            item.put("correct", graded != null && graded.path("correct").asBoolean());
            setOrNull(item, "conceptTags", graded != null ? graded.get("conceptTags") : p.get("conceptTags"));
            out.add(item);
        }
        return out;
    }

    private void setOrNull(ObjectNode item, String name, JsonNode value) {
        if (value == null || value.isMissingNode()) {
            item.putNull(name);
        } else {
            item.set(name, value);
        }
    }

    @Transactional
    public SubmitResponse submit(AuthUser authUser, Long assignmentId, SubmitRequest request) {
        Assignment assignment = assignmentRepository.findById(assignmentId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "assignment-not-found",
                        "과제를 찾을 수 없습니다."));
        accessGuard.requireMember(assignment.getClassroom().getId(), authUser.id());
        // 대상(학년·학생)이 지정된 과제는 그 학생만 제출 가능 — 목록에 안 떠도 id 로 직접 찌르는 것을 막는다.
        Short studentGrade = userRepository.findById(authUser.id()).map(User::getGrade).orElse(null);
        if (!assignment.isVisibleTo(authUser.id(), studentGrade)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "assignment-not-assigned",
                    "회원님에게 공개된 과제가 아닙니다.");
        }
        requireSubmittable(assignment);

        JsonNode content = readTree(assignment.getContent());
        GradeResult grade = gradingService.grade(content, request.answers(), assignment.getType());

        int attemptNo = submissionRepository
                .countByAssignmentIdAndStudentId(assignmentId, authUser.id()) + 1;
        User student = userRepository.getReferenceById(authUser.id());
        Submission submission = submissionRepository.save(Submission.create(
                assignment, student, writeJson(request.answers()),
                grade.score(), writeJson(grade.results()), attemptNo));

        return new SubmitResponse(submission.getId(), grade.score(),
                grade.correctCount(), grade.totalCount(), grade.results());
    }

    // 부록 B-5: published_at IS NOT NULL AND (due_at IS NULL OR due_at > now)
    private void requireSubmittable(Assignment assignment) {
        if (!assignment.isPublished()) {
            throw new ApiException(HttpStatus.CONFLICT, "assignment-not-published",
                    "아직 공개되지 않은 과제입니다.");
        }
        if (assignment.getDueAt() != null && assignment.getDueAt().isBefore(LocalDateTime.now())) {
            throw new ApiException(HttpStatus.CONFLICT, "assignment-past-due",
                    "마감된 과제입니다.");
        }
    }

    private JsonNode readTree(String json) {
        try {
            return objectMapper.readTree(json);
        } catch (JacksonException e) {
            throw new IllegalStateException("과제 문제 데이터를 해석할 수 없습니다.", e);
        }
    }

    private String writeJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JacksonException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-json",
                    "제출 데이터를 직렬화할 수 없습니다.");
        }
    }
}
