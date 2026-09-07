package com.mallang.assignment.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** ai.* 설정 바인딩. */
@ConfigurationProperties(prefix = "ai")
public record AiProperties(
        String provider,       // stub | anthropic | openai
        Anthropic anthropic,
        OpenAi openai,
        Material material,
        Duration jobTtl
) {
    /**
     * 프롬프트에 실을 학습자료 분량.
     *
     * <p>모델 한계가 아니라 <b>우리가 정한 예산</b>이다. 입력 컨텍스트는 gpt-4o 128k,
     * claude 200k 토큰이라 한글 수만 자를 넣어도 남는다 — 그런데도 상한을 두는 이유는
     * 게이트웨이(SSAFY GMS)가 자체 상한을 둘 수 있고, 프롬프트가 길수록 느려지고 비싸지며,
     * 너무 길면 모델이 어느 대목을 봐야 할지 흐려지기 때문이다.</p>
     *
     * <p>설정으로 뺀 이유는 그 값이 <b>환경에 따라 다르기</b> 때문이다. 게이트웨이가 400 을
     * 주기 시작하면 배포 없이 env 로 낮출 수 있어야 한다.</p>
     */
    public record Material(int maxCharsTotal, int maxCharsPerMaterial) {
    }

    /** 설정에 material 블록이 없을 때 쓰는 값 — application.yml 기본값과 같게 유지한다 */
    private static final Material DEFAULT_MATERIAL = new Material(60_000, 20_000);

    /**
     * 설정이 비어 있어도 기본값을 준다.
     *
     * <p>이 값을 안 읽는 테스트가 여럿이라(생성기 단위 테스트) 거기서 null 을 넣게 두고,
     * 실제로 읽는 쪽은 언제나 값을 받게 한다 — 설정 한 줄이 빠졌다고 생성이 NPE 로 죽으면
     * 원인을 찾기 어렵다.</p>
     *
     * <p><b>편의 생성자를 두지 않는다.</b> 레코드에 생성자가 둘이면 Spring 이 어느 것으로
     * 바인딩할지 몰라 "No default constructor found" 로 컨텍스트가 통째로 안 뜬다.
     * 그래서 호출부는 인자를 다 적는다.</p>
     */
    @Override
    public Material material() {
        return material != null ? material : DEFAULT_MATERIAL;
    }

    public record Anthropic(String apiKey, String model, long maxTokens, String baseUrl) {
    }

    /** OpenAI 호환 게이트웨이(SSAFY GMS 등). base-url + Bearer 토큰 + /chat/completions. */
    public record OpenAi(String apiKey, String baseUrl, String model, long maxTokens, String chatPath) {
    }
}
