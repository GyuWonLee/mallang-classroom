package com.mallang.assignment.ai;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GMS 채팅 클라이언트 생성.
 *
 * <p>이 판단이 틀리면 두 방향으로 조용히 망가진다 — 키가 없는데 만들어 버리면 실제 호출에서
 * NPE 가 나고, 키가 있는데 안 만들면 폴백(템플릿·안내 문구)이 영원히 걸려 AI 기능이 켜지지
 * 않는다. 둘 다 로컬에서는 티가 안 난다.</p>
 *
 * <p>{@code null} 이 곧 "부를 수 없다"는 계약이라 호출부가 별도 플래그를 두지 않는다 —
 * 그래서 여기서 경계를 하나씩 고정한다.</p>
 */
class GmsChatClientsTest {

    private static final Duration READ_TIMEOUT = Duration.ofSeconds(15);

    @Test
    void buildsAClientWhenGmsIsFullyConfigured() {
        assertThat(GmsChatClients.orNull(props("openai", "sk-test"), READ_TIMEOUT)).isNotNull();
    }

    @Test
    void anotherProviderMeansNoGmsClient() {
        // provider=stub/anthropic 이면 GMS 를 부르지 않는다 — 키가 있어도 마찬가지다
        assertThat(GmsChatClients.orNull(props("stub", "sk-test"), READ_TIMEOUT)).isNull();
        assertThat(GmsChatClients.orNull(props("anthropic", "sk-test"), READ_TIMEOUT)).isNull();
    }

    @Test
    void providerIsMatchedCaseInsensitively() {
        // 환경변수로 들어오는 값이라 대소문자가 섞인다
        assertThat(GmsChatClients.orNull(props("OpenAI", "sk-test"), READ_TIMEOUT)).isNotNull();
    }

    @Test
    void missingOrBlankKeyMeansNoClient() {
        assertThat(GmsChatClients.orNull(props("openai", null), READ_TIMEOUT)).isNull();
        assertThat(GmsChatClients.orNull(props("openai", ""), READ_TIMEOUT)).isNull();
        // 배포에서 env 가 비면 빈 문자열로 들어온다 — 공백만 있는 것도 없는 것이다
        assertThat(GmsChatClients.orNull(props("openai", "   "), READ_TIMEOUT)).isNull();
    }

    @Test
    void missingOpenAiBlockMeansNoClient() {
        // ai.openai.* 를 통째로 안 넣은 환경(로컬 기본값)
        assertThat(GmsChatClients.orNull(
                new AiProperties("openai", null, null, null, null), READ_TIMEOUT)).isNull();
    }

    private AiProperties props(String provider, String apiKey) {
        return new AiProperties(provider, null,
                new AiProperties.OpenAi(apiKey, "https://gms.example/v1", "gpt-x", 300,
                        "/chat/completions"),
                null,
                null);
    }
}
