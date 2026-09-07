package com.mallang.assignment.ai;

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
 * SSAFY GMS(OpenAI 호환 게이트웨이)로 실제 과제 생성을 확인하는 스모크 테스트.
 * AI_OPENAI_API_KEY(=GMS 키) 가 있을 때만 실행되고, 없으면 자동 skip. DB/Redis 불필요.
 *
 * 실행 (PowerShell):
 *   $env:AI_OPENAI_API_KEY = Read-Host "GMS 키"
 *   # 필요시 모델/주소 덮어쓰기:
 *   # $env:AI_OPENAI_MODEL = "gpt-4o"
 *   # $env:AI_OPENAI_BASE_URL = "https://gms.ssafy.io/gmsapi/api.openai.com"
 *   .\gradlew.bat cleanTest test --tests "*GmsAssignmentGeneratorLiveTest" --info
 */
@EnabledIfEnvironmentVariable(named = "AI_OPENAI_API_KEY", matches = ".+")
class GmsAssignmentGeneratorLiveTest {

    @Test
    void generatesGroundedDraftViaGmsGateway() {
        String apiKey = System.getenv("AI_OPENAI_API_KEY");
        String baseUrl = System.getenv().getOrDefault(
                "AI_OPENAI_BASE_URL", "https://gms.ssafy.io/gmsapi/api.openai.com");
        String chatPath = System.getenv().getOrDefault("AI_OPENAI_CHAT_PATH", "/v1/chat/completions");
        String model = System.getenv().getOrDefault("AI_OPENAI_MODEL", "gpt-4o");

        ObjectMapper mapper = JsonMapper.builder().build();
        AiProperties props = new AiProperties(
                "openai",
                null,
                new AiProperties.OpenAi(apiKey, baseUrl, model, 4000, chatPath),
                null,
                Duration.ofHours(24));

        OpenAiAssignmentGenerator generator = new OpenAiAssignmentGenerator(props, mapper);
        MaterialSource materialSource = new MaterialSource(null, props); // 내장 자료만 쓰므로 repo 불필요

        GenerationCommand command = new GenerationCommand(
                Subject.KOREAN, AssignmentType.DICTATION, 2, 5,
                materialSource.resolve(1L, List.of("builtin-korean-g2")));

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
        runner.run(GenerationJob.queued("gen-live-gms", 1L, 1L), command);

        System.out.println("\n===== GMS로 생성한 과제 초안 (model=" + model + ") =====");
        System.out.println(mapper.writerWithDefaultPrettyPrinter().writeValueAsString(draftHolder[0]));
        System.out.println("====================================================\n");
    }
}
