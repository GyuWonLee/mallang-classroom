package com.mallang.global.error;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;
import java.util.List;
import java.util.Map;

/**
 * 모든 에러 응답을 RFC 9457(Problem Details) 형식으로 통일 (API 명세 공통 규칙).
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final String TYPE_BASE = "https://mallang.app/errors/";

    @ExceptionHandler(ApiException.class)
    public ProblemDetail handleApiException(ApiException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(e.getStatus(), e.getMessage());
        problem.setType(URI.create(TYPE_BASE + e.getType()));
        problem.setTitle(e.getMessage());
        return problem;
    }

    // @Valid 검증 실패 → 400 + 필드별 에러 목록 (명세: errors 확장 필드)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.BAD_REQUEST, "요청 값이 올바르지 않습니다.");
        problem.setType(URI.create(TYPE_BASE + "validation-failed"));
        problem.setTitle("검증 실패");
        List<Map<String, String>> errors = e.getBindingResult().getFieldErrors().stream()
                .map(fe -> Map.of("field", fe.getField(),
                        "message", fe.getDefaultMessage() == null ? "" : fe.getDefaultMessage()))
                .toList();
        problem.setProperty("errors", errors);
        return problem;
    }

    /**
     * DB 제약 위반 → 409. 500 이 아니다.
     *
     * <p>이 프로젝트에는 유니크 제약이 여럿이고({@code uq_classroom_member},
     * {@code uq_team_member_classroom_user}, {@code uq_submission}, {@code invite.code},
     * {@code uq_ai_tutor_memory}), 그중 다수가 soft delete 된 행까지 덮는다. "먼저 조회해
     * 보고 없으면 넣는다" 는 코드가 <b>동시 요청</b>이나 <b>지워진 행</b> 앞에서 무너지는데,
     * 지금까지는 그때마다 스택트레이스와 함께 500 이 나갔다. 학급 생성 500(V20)·재초대
     * 500 이 모두 같은 모양이었다.
     *
     * <p>각 호출 지점을 고치는 것이 먼저지만(이 MR 이 하는 일), 남은 경로와 앞으로 생길
     * 경로를 위한 그물이 필요하다. 409 는 프론트가 "다시 시도해 주세요"로 처리할 수 있는
     * 신호이고, 500 은 아니다.
     *
     * <p>메시지에 DB 원문을 담지 않는다 — 제약 이름·컬럼·값이 그대로 나가면 스키마가 새고,
     * 아이가 읽을 화면에 영어 스택이 뜬다. 원인은 로그에만 남긴다.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ProblemDetail handleDataIntegrityViolation(DataIntegrityViolationException e) {
        log.warn("DB 제약 위반 — 409 로 응답한다", e);
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.CONFLICT, "이미 처리된 요청이거나 다른 요청과 겹쳤습니다. 잠시 후 다시 시도해 주세요.");
        problem.setType(URI.create(TYPE_BASE + "conflict"));
        problem.setTitle("중복 요청");
        return problem;
    }
}
