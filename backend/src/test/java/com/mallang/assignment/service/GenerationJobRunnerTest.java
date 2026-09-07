package com.mallang.assignment.service;

import com.mallang.assignment.ai.AiProperties;
import com.mallang.assignment.ai.AssignmentGenerator;
import com.mallang.assignment.ai.AssignmentVerifier;
import com.mallang.assignment.ai.DictationGenerator;
import com.mallang.assignment.ai.GeneratedAssignment;
import com.mallang.assignment.ai.GenerationCommand;
import com.mallang.assignment.ai.GenerationRejectedException;
import com.mallang.assignment.ai.ResolvedMaterial;
import com.mallang.assignment.ai.StubAssignmentGenerator;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class GenerationJobRunnerTest {

    @Mock GenerationJobStore jobStore;
    @Captor ArgumentCaptor<GenerationJob> jobCaptor;

    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    // provider=stub → GMS 없음. 검증기/받아쓰기 다듬기 모두 LLM 없이(빈 결과/규칙 폴백) 동작한다.
    private final AiProperties stubProps = new AiProperties("stub", null, null, null, null);
    private final AssignmentVerifier verifier = new AssignmentVerifier(stubProps, objectMapper);
    private final DictationGenerator dictation = new DictationGenerator(stubProps, objectMapper);

    @Test
    void assemblesGroundedDraftAndMarksJobDone() {
        GenerationJobRunner runner = new GenerationJobRunner(
                new StubAssignmentGenerator(), dictation, verifier, jobStore, objectMapper);

        GenerationCommand command = new GenerationCommand(
                Subject.KOREAN, AssignmentType.MULTIPLE_CHOICE, 2, 3,
                List.of(new ResolvedMaterial("builtin-korean-g2", "국어 2학년", "학교에 갔다\n동생이 웃었다")));
        GenerationJob queued = GenerationJob.queued("gen-test", 10L, 99L);

        runner.run(queued, command);

        verify(jobStore, atLeastOnce()).save(jobCaptor.capture());
        GenerationJob last = jobCaptor.getValue();

        assertThat(last.status()).isEqualTo(JobStatus.DONE);
        JsonNode draft = last.draft();
        assertThat(draft.get("source").asString()).isEqualTo("AI_GENERATED");
        assertThat(draft.get("sourceMaterialIds").get(0).asString()).isEqualTo("builtin-korean-g2");
        // 학년은 화면 표시용으로 초안에 실린다 (요청 grade=2)
        assertThat(draft.get("grade").asInt()).isEqualTo(2);

        JsonNode problems = draft.get("content").get("problems");
        assertThat(problems.size()).isEqualTo(3);
        // grounding: 각 문항은 근거 자료 id·원문 인용을 담아야 한다
        JsonNode first = problems.get(0);
        assertThat(first.get("sourceRef").get("materialId").asString()).isEqualTo("builtin-korean-g2");
        assertThat(first.get("sourceRef").get("quote").asString()).isNotBlank();
        assertThat(first.get("choices").isArray()).isTrue(); // 객관식 보기
    }

    @Test
    void dictationIsBuiltFromMaterialSentences() {
        // 받아쓰기는 전용 생성기로 라우팅 — 본문 문장을 뽑아 만든다(LLM 없이도, 거절 없이).
        GenerationJobRunner runner = new GenerationJobRunner(
                new StubAssignmentGenerator(), dictation, verifier, jobStore, objectMapper);
        GenerationCommand command = new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 3,
                List.of(new ResolvedMaterial("builtin-korean-g2", "국어 2학년",
                        "학교에 갔다\n동생이 웃었다\n비가 내렸다")));

        runner.run(GenerationJob.queued("gen-dictation", 1L, 1L), command);

        verify(jobStore, atLeastOnce()).save(jobCaptor.capture());
        JsonNode problems = jobCaptor.getValue().draft().get("content").get("problems");
        assertThat(problems.size()).isEqualTo(3);
        JsonNode first = problems.get(0);
        // 받아쓰기: 보기 없이 answerText 가 곧 읽어줄 문장이고, 자료에서 온 문장이어야 한다
        assertThat(first.get("choices").isNull()).isTrue();
        assertThat(first.get("answerText").asString())
                .isIn("학교에 갔다", "동생이 웃었다", "비가 내렸다");
    }

    @Test
    void stripsGradeSubjectPrefixFromTitle() {
        // 모델이 "1학년 1학기 국어:" 접두사를 붙여도 초안 제목은 학습 주제만 남긴다
        AssignmentGenerator prefixed = command -> new GeneratedAssignment("ok", null,
                "1학년 1학기 국어: 다정하게 인사해요",
                List.of(new GeneratedAssignment.Problem(1, "안녕", List.of("가", "나"), 0, null,
                        List.of("맞춤법"), 2, "builtin-korean-g1", "안녕하세요")));
        GenerationJobRunner runner = new GenerationJobRunner(
                prefixed, dictation, verifier, jobStore, objectMapper);
        GenerationCommand command = new GenerationCommand(
                Subject.KOREAN, AssignmentType.MULTIPLE_CHOICE, 1, 1,
                List.of(new ResolvedMaterial("builtin-korean-g1", "국어 1학년", "안녕하세요")));

        runner.run(GenerationJob.queued("gen-title", 1L, 1L), command);

        verify(jobStore, atLeastOnce()).save(jobCaptor.capture());
        assertThat(jobCaptor.getValue().draft().get("title").asString()).isEqualTo("다정하게 인사해요");
    }

    @Test
    void rejectedGenerationFailsWithFriendlyGuidance() {
        // 두 모드 모두 거절하면(시스템 오류가 아님) 선생님이 다음에 뭘 할지 아는 안내로 바꾼다
        AssignmentGenerator rejecting = command -> {
            throw new GenerationRejectedException("문항을 만들 수 있는 내용이 아닙니다");
        };
        GenerationJobRunner runner = new GenerationJobRunner(
                rejecting, dictation, verifier, jobStore, objectMapper);
        GenerationCommand command = new GenerationCommand(
                Subject.KOREAN, AssignmentType.MULTIPLE_CHOICE, 2, 3,
                List.of(new ResolvedMaterial("builtin-korean-g2", "국어 2학년", "학교에 갔다")));

        runner.run(GenerationJob.queued("gen-reject", 1L, 1L), command);

        verify(jobStore, atLeastOnce()).save(jobCaptor.capture());
        GenerationJob last = jobCaptor.getValue();
        assertThat(last.status()).isEqualTo(JobStatus.FAILED);
        assertThat(last.error()).contains("문항을 만들기 어려워요"); // 친절 안내
        assertThat(last.error()).doesNotContain("Exception"); // 내부 오류 메시지·스택 노출 안 함
    }

    // ── 빈칸 학습지 구제: 엄격 인용 → 범위 모드 재시도 ──────────────────────────

    /**
     * <b>선생님이 올리는 자료는 읽기 지문만이 아니다.</b>
     *
     * <p>실제로 올라온 건 경기도교육청 3학년 나눗셈 활동지였다. 추출하면 문장이 이렇다:
     * "① 3개씩 묶으면      묶음입니다." — 답이 빈칸이라 <b>그대로 인용해도 정답이 확정되지
     * 않는다.</b> 엄격 모드는 "인용문만 읽고도 풀리는 문항만"을 요구하므로 만들 수 있는 문항이
     * 하나도 없고, 모델은 규칙대로 거절한다. 선생님 화면에는 "이 자료로는 문항을 만들기
     * 어려워요"만 뜬다 — 자료는 멀쩡한데.</p>
     *
     * <p>그래서 이 판정에 한해 자료를 '출제 범위'로만 쓰는 모드로 한 번 더 간다.</p>
     */
    @Test
    void retriesAsScopeModeWhenTheMaterialCannotBeQuoted() {
        RecordingGenerator generator = new RecordingGenerator("문항을 만들 수 있는 내용이 아닙니다.");
        GenerationJobRunner runner = new GenerationJobRunner(
                generator, dictation, verifier, jobStore, objectMapper);

        runner.run(GenerationJob.queued("gen-worksheet", 1L, 1L), worksheetCommand());

        // 엄격(false) 으로 한 번, 범위(true) 로 한 번
        assertThat(generator.modes).containsExactly(false, true);

        verify(jobStore, atLeastOnce()).save(jobCaptor.capture());
        GenerationJob last = jobCaptor.getValue();
        assertThat(last.status()).isEqualTo(JobStatus.DONE);
        assertThat(last.draft().get("content").get("problems").size()).isEqualTo(1);
        // 검수 화면이 "인용문이 자료 원문이 아니다"를 알릴 수 있게 표시를 싣는다
        assertThat(last.draft().get("scopeExpanded").asBoolean()).isTrue();
    }

    /** 그냥 성공한 생성에는 표시가 붙지 않는다 — 인용문이 자료 원문 그대로다. */
    @Test
    void normalGenerationIsNotMarkedAsScopeExpanded() {
        GenerationJobRunner runner = new GenerationJobRunner(
                new StubAssignmentGenerator(), dictation, verifier, jobStore, objectMapper);
        GenerationCommand command = new GenerationCommand(
                Subject.KOREAN, AssignmentType.MULTIPLE_CHOICE, 2, 1,
                List.of(new ResolvedMaterial("builtin-korean-g2", "국어 2학년", "학교에 갔다")));

        runner.run(GenerationJob.queued("gen-plain", 1L, 1L), command);

        verify(jobStore, atLeastOnce()).save(jobCaptor.capture());
        assertThat(jobCaptor.getValue().draft().get("scopeExpanded").asBoolean()).isFalse();
    }

    /**
     * 자료에 글자가 아예 없으면 재시도하지 않는다 — 모드를 바꿔도 읽을 게 없다.
     * 스캔 PDF 를 텍스트 추출 없이 올린 경우라, 선생님이 알아야 할 것은 '자료를 바꾸라'다.
     */
    @Test
    void doesNotRetryWhenTheMaterialHasNoTextAtAll() {
        RecordingGenerator generator = new RecordingGenerator("학습자료가 비어 있습니다.");
        GenerationJobRunner runner = new GenerationJobRunner(
                generator, dictation, verifier, jobStore, objectMapper);

        runner.run(GenerationJob.queued("gen-empty", 1L, 1L), worksheetCommand());

        assertThat(generator.modes).containsExactly(false); // 한 번만
        verify(jobStore, atLeastOnce()).save(jobCaptor.capture());
        GenerationJob last = jobCaptor.getValue();
        assertThat(last.status()).isEqualTo(JobStatus.FAILED);
        // 사유별 안내가 제대로 걸린다 — 마침표 때문에 default 로 새면 안 된다
        assertThat(last.error()).contains("글자가 들어 있는 학습자료인지");
    }

    /**
     * 이미 범위 모드인 요청(오답 클리닉)은 다시 갈 곳이 없다 — 두 번 부르면 크레딧만 쓴다.
     */
    @Test
    void doesNotRetryWhatIsAlreadyScopeMode() {
        RecordingGenerator generator =
                new RecordingGenerator("문항을 만들 수 있는 내용이 아닙니다.", false);
        GenerationJobRunner runner = new GenerationJobRunner(
                generator, dictation, verifier, jobStore, objectMapper);

        runner.run(GenerationJob.queued("gen-clinic", 1L, 1L),
                worksheetCommand().expandingFromScope());

        assertThat(generator.modes).containsExactly(true);
        verify(jobStore, atLeastOnce()).save(jobCaptor.capture());
        assertThat(jobCaptor.getValue().status()).isEqualTo(JobStatus.FAILED);
    }

    private GenerationCommand worksheetCommand() {
        return new GenerationCommand(
                Subject.MATH, AssignmentType.MULTIPLE_CHOICE, 3, 1,
                List.of(new ResolvedMaterial("77", "3-1-3.pdf",
                        "3학년 1학기 수와 연산 3. 나눗셈\n① 3개씩 묶으면      묶음입니다.")));
    }

    /**
     * 호출된 모드를 기록하고, <b>범위 모드일 때만</b> 성공하는 생성기.
     * 빈칸 학습지에 대한 실제 모델의 반응을 흉내낸다.
     */
    private static final class RecordingGenerator implements AssignmentGenerator {

        private final String rejectReason;
        /** false 면 범위 모드에서도 거절한다 — '재시도해도 안 되는' 경우를 재현할 때 쓴다 */
        private final boolean succeedsInScopeMode;
        /** 호출 순서대로의 expandFromScope 값 */
        final List<Boolean> modes = new ArrayList<>();

        RecordingGenerator(String rejectReason) {
            this(rejectReason, true);
        }

        RecordingGenerator(String rejectReason, boolean succeedsInScopeMode) {
            this.rejectReason = rejectReason;
            this.succeedsInScopeMode = succeedsInScopeMode;
        }

        @Override
        public GeneratedAssignment generate(GenerationCommand command) {
            modes.add(command.expandFromScope());
            if (!command.expandFromScope() || !succeedsInScopeMode) {
                throw new GenerationRejectedException(rejectReason);
            }
            return new GeneratedAssignment("ok", null, "나눗셈 알아보기",
                    List.of(new GeneratedAssignment.Problem(1, "사과 12개를 4명에게 똑같이 나누면?",
                            List.of("2개", "3개", "4개", "6개"), 1, null, List.of("나눗셈"), 2,
                            "77", "사과 12개를 4명에게 똑같이 나누어 줍니다")));
        }
    }
}
