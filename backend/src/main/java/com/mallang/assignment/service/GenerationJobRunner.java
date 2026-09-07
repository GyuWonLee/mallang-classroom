package com.mallang.assignment.service;

import com.mallang.assignment.ai.AssignmentGenerator;
import com.mallang.assignment.ai.AssignmentVerifier;
import com.mallang.assignment.ai.DictationGenerator;
import com.mallang.assignment.ai.GeneratedAssignment;
import com.mallang.assignment.ai.GenerationCommand;
import com.mallang.assignment.ai.GenerationRejectedException;
import com.mallang.assignment.entity.AssignmentSource;
import com.mallang.assignment.entity.AssignmentType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AI 생성 비동기 실행부. LLM 호출 → 초안(content JSON) 조립 → genjob 상태 갱신.
 * 조립 결과는 검수 후 그대로 POST .../assignments 로 확정 저장할 수 있는 형태(§7 스키마)다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GenerationJobRunner {

    private final AssignmentGenerator generator;
    private final DictationGenerator dictationGenerator;
    private final AssignmentVerifier verifier;
    private final GenerationJobStore jobStore;
    private final ObjectMapper objectMapper;

    /** 자료를 그대로 인용해 낼 수 없다는 판정 — 이때만 '범위 모드'로 한 번 더 시도한다. */
    private static final String NOT_QUOTABLE = "문항을 만들 수 있는 내용이 아닙니다";

    @Async("aiGenerationExecutor")
    public void run(GenerationJob job, GenerationCommand command) {
        jobStore.save(job.running());
        try {
            JsonNode draft;
            try {
                draft = generate(command, false);
            } catch (GenerationRejectedException e) {
                if (!worthRetryingAsScope(command, e.reason())) {
                    throw e;
                }
                /*
                  자료가 빈칸 학습지라 인용할 문장이 없다는 뜻이다. 자료를 '출제 범위'로만 쓰고
                  그 안에서 새 예문을 지어 내는 모드로 한 번 더 간다 — 선생님 입장에서는
                  "3학년 나눗셈 학습지를 골랐는데 왜 안 되지"가 되지 않아야 한다.
                */
                log.info("엄격 인용으로 거절 → 범위 모드로 재시도 (jobId={}): {}", job.jobId(), e.reason());
                draft = generate(command.expandingFromScope(), true);
            }
            jobStore.save(job.done(draft));
        } catch (GenerationRejectedException e) {
            // 시스템 오류가 아니라 '이 자료로는 못 만든다'는 판정 — 선생님이 무엇을 하면 되는지 안내로 바꾼다.
            log.info("AI 과제 생성 거절 (jobId={}): {}", job.jobId(), e.reason());
            jobStore.save(job.failed(friendlyReject(e.reason())));
        } catch (Exception e) {
            log.error("AI 과제 생성 실패 (jobId={})", job.jobId(), e);
            jobStore.save(job.failed(e.getMessage() != null ? e.getMessage() : "생성 중 오류가 발생했습니다."));
        }
    }

    private JsonNode generate(GenerationCommand command, boolean scopeExpanded) {
        boolean dictation = command.type() == AssignmentType.DICTATION;
        // 받아쓰기는 창작이 아니라 본문 문장 추출이라 전용 생성기로 — LLM 거절 없이 자료만 있으면 만든다.
        GeneratedAssignment generated = dictation
                ? dictationGenerator.generate(command)
                : generator.generate(command);
        // 자료 없이 풀리는지 검증은 '인용+발문+보기'가 있는 유형만. 받아쓰기는 들려주고 받아쓰는 거라 해당 없음.
        Map<Integer, AssignmentVerifier.Verdict> verdicts = dictation
                ? Map.of()
                : verifier.verify(generated.problems());
        return assembleDraft(generated, command, verdicts, scopeExpanded);
    }

    /**
     * 범위 모드로 한 번 더 시도할 값어치가 있는 거절인지.
     *
     * <p>"인용할 문장이 없다"는 판정에만 해당한다. 자료에 글자가 아예 없거나(추출 실패),
     * 문항 유형이 안 맞거나, 생성이 잘린 경우는 모드를 바꿔도 결과가 같아 선생님에게 바로
     * 알린다. 이미 범위 모드인 요청(오답 클리닉)도 다시 갈 곳이 없다.</p>
     *
     * <p>받아쓰기는 전용 생성기가 본문에서 문장을 뽑는 방식이라 이 프롬프트 모드와 무관하다.</p>
     */
    private boolean worthRetryingAsScope(GenerationCommand command, String reason) {
        return !command.expandFromScope()
                && command.type() != AssignmentType.DICTATION
                && NOT_QUOTABLE.equals(normalizeReason(reason));
    }

    /**
     * 거절 사유에서 문장부호를 벗겨 비교용으로 맞춘다.
     *
     * <p>프롬프트가 정한 사유는 마침표로 끝나는데("학습자료가 비어 있습니다.") 우리가 직접 던지는
     * 같은 뜻의 사유에는 마침표가 없다. 이걸 맞추지 않으면 아래 안내 매핑이 <b>전부 default 로
     * 빠져</b>, 글자가 없는 PDF 를 올린 선생님에게도 "문항 유형을 바꿔 보라"는 엉뚱한 말이 나간다.</p>
     */
    private String normalizeReason(String reason) {
        return reason == null ? "" : reason.strip().replaceAll("[.。]+$", "").strip();
    }

    /** LLM 거절 사유(프롬프트가 정한 4가지)를 선생님이 바로 다음 행동을 알 수 있는 안내로 바꾼다. */
    private String friendlyReject(String reason) {
        return switch (normalizeReason(reason)) {
            case "학습자료가 비어 있습니다" ->
                    "자료에서 글을 찾지 못했어요. 글자가 들어 있는 학습자료인지 확인한 뒤 다시 시도해 주세요.";
            case "지원하지 않는 문항 유형입니다" ->
                    "이 자료로는 요청한 유형의 문항을 만들기 어려워요. 다른 문항 유형을 선택해 다시 시도해 주세요.";
            case "생성 결과가 잘렸습니다" ->
                    "문항이 많아 생성이 중간에 잘렸어요. 문항 수를 줄이거나 학습자료를 짧게 해서 다시 시도해 주세요.";
            // "문항을 만들 수 있는 내용이 아닙니다" · "문항 생성 요청이 아닙니다" 등
            default ->
                    "이 자료로는 문항을 만들기 어려워요. 자료에 설명이나 지문 같은 글이 담겨 있는지 "
                            + "확인하거나, 문항 유형을 바꿔 다시 시도해 주세요.";
        };
    }

    private JsonNode assembleDraft(GeneratedAssignment generated, GenerationCommand command,
                                   Map<Integer, AssignmentVerifier.Verdict> verdicts,
                                   boolean scopeExpanded) {
        List<String> materialIds = command.materials().stream().map(m -> m.materialId()).toList();
        String defaultMaterialId = materialIds.get(0);

        List<Map<String, Object>> problems = new ArrayList<>();
        for (GeneratedAssignment.Problem p : generated.problems()) {
            Map<String, Object> problem = new LinkedHashMap<>();
            problem.put("no", p.no());
            problem.put("prompt", p.prompt());
            problem.put("choices", p.choices());
            problem.put("answer", p.answer());
            problem.put("answerText", p.answerText());
            problem.put("conceptTags", p.conceptTags());
            problem.put("level", p.level());
            String materialId = p.sourceMaterialId() != null ? p.sourceMaterialId() : defaultMaterialId;
            problem.put("sourceRef", Map.of("materialId", materialId, "quote",
                    p.sourceQuote() != null ? p.sourceQuote() : ""));
            // 검증 결과가 있으면 실어 준다(검수 화면이 경고를 띄운다). 미검증이면 필드 자체를 넣지 않는다.
            AssignmentVerifier.Verdict verdict = verdicts.get(p.no());
            if (verdict != null) {
                problem.put("verified", verdict.solvable());
                problem.put("verifyNote", verdict.note());
            }
            problems.add(problem);
        }

        Map<String, Object> draft = new LinkedHashMap<>();
        // 제목은 주제만 — 프롬프트로 지시하지만 모델이 "1학년 1학기 국어:" 접두사를 붙이는 경우가 있어 한 번 더 벗긴다.
        draft.put("title", cleanTitle(generated.title()));
        draft.put("subject", command.subject().name());
        // 학년은 화면 표시(예: "1학년 국어")용으로 저장까지 이어지도록 초안에 실어 준다.
        draft.put("grade", command.grade());
        draft.put("type", command.type().name());
        draft.put("source", AssignmentSource.AI_GENERATED.name());
        draft.put("sourceMaterialIds", materialIds);
        // 자료를 그대로 인용하지 못해 '범위'로만 쓴 경우 — 검수 화면이 선생님에게 그 사실을 알린다.
        // 인용문이 자료 원문이 아니라 새로 지은 예문이므로, 모르고 넘어가면 검수의 뜻이 흐려진다.
        draft.put("scopeExpanded", scopeExpanded);
        draft.put("dueAt", null);
        draft.put("content", Map.of("problems", problems));
        return objectMapper.valueToTree(draft);
    }

    /**
     * 제목에서 "1학년 1학기 국어:" 같은 학년·학기·과목 접두사를 벗겨 학습 주제만 남긴다.
     * 화면은 학년·과목을 별도 필드로 표시하므로 제목엔 주제만 있으면 된다. 접두사가 없으면 그대로 둔다.
     */
    private String cleanTitle(String title) {
        if (title == null) {
            return null;
        }
        // 맨 앞의 (학년|학기|국어|한자)로 시작해 콜론으로 끝나는 덩어리를 제거. 그런 접두사가 없으면 변화 없음.
        String cleaned = title.strip()
                .replaceFirst("^(?:\\d+\\s*학년|\\d+\\s*학기|국어|한자)[^:：]*[:：]\\s*", "")
                .strip();
        return cleaned.isEmpty() ? title.strip() : cleaned;
    }
}
