package com.mallang.assignment.ai;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.material.MaterialSource;
import com.mallang.assignment.service.GenerationJob;
import com.mallang.assignment.service.GenerationJobRunner;
import com.mallang.assignment.service.GenerationJobStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.List;

/**
 * 실제 Claude를 호출해 AI 과제 생성을 눈으로 확인하는 스모크 테스트.
 * ANTHROPIC_API_KEY 환경변수가 있을 때만 실행되고, 없으면 자동으로 건너뛴다.
 * DB/Redis/스프링 컨텍스트가 필요 없다 — 생성기와 초안 조립만 직접 돌린다.
 *
 * 실행:  ANTHROPIC_API_KEY=sk-... ./gradlew test --tests "*ClaudeAssignmentGeneratorLiveTest" -i
 */
@EnabledIfEnvironmentVariable(named = "ANTHROPIC_API_KEY", matches = ".+")
class ClaudeAssignmentGeneratorLiveTest {

    @Test
    void generatesGroundedDraftFromBuiltinMaterial() {
        String apiKey = System.getenv("ANTHROPIC_API_KEY");
        String model = System.getenv().getOrDefault("ANTHROPIC_MODEL", "claude-opus-5");
        String baseUrl = System.getenv("ANTHROPIC_BASE_URL"); // 게이트웨이 쓸 때만

        ObjectMapper mapper = JsonMapper.builder().build();
        AiProperties props = new AiProperties(
                "anthropic",
                new AiProperties.Anthropic(apiKey, model, 16000, baseUrl),
                null,
                null,
                Duration.ofHours(24));

        var clientBuilder = AnthropicOkHttpClient.builder().apiKey(apiKey);
        if (baseUrl != null && !baseUrl.isBlank()) {
            clientBuilder.baseUrl(baseUrl);
        }
        AnthropicClient client = clientBuilder.build();
        ClaudeAssignmentGenerator generator = new ClaudeAssignmentGenerator(client, props, mapper);
        MaterialSource materialSource = new MaterialSource(null, props); // 내장 자료만 쓰므로 repo 불필요

        GenerationCommand command = new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 5,
                materialSource.resolve(1L, List.of("builtin-korean-g2")));

        // genjob 상태 저장은 메모리로 가로채 초안만 뽑아온다 (Redis 불필요).
        JsonNode[] draftHolder = new JsonNode[1];
        GenerationJobStore capturingStore = new GenerationJobStore(null, mapper, props) {
            @Override
            public void save(GenerationJob job) {
                if (job.draft() != null) {
                    draftHolder[0] = job.draft();
                }
            }
        };

        GenerationJobRunner runner = new GenerationJobRunner(generator,
                new DictationGenerator(props, mapper), new AssignmentVerifier(props, mapper),
                capturingStore, mapper);
        runner.run(GenerationJob.queued("gen-live", 1L, 1L), command);

        System.out.println("\n===== Claude가 생성한 과제 초안 (모델=" + model + ") =====");
        System.out.println(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(draftHolder[0]));
        System.out.println("=================================================\n");
    }
}
