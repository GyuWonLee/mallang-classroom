package com.mallang.material.service;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 추출 2단계(멀티모달) 조절값. 키·base-url 은 ai.openai.* (AiProperties)를 그대로 쓰고,
 * 여기서는 "얼마나 크게, 몇 장까지 보낼지"만 정한다 — 이게 곧 비용이기 때문.
 */
@ConfigurationProperties(prefix = "mallang.material.vision")
public record VisionExtractionProperties(
        String model,
        int maxPages,
        int maxImageWidth,
        int renderDpi,
        long maxOutputTokens
) {
    public VisionExtractionProperties {
        // 문서 전사는 저가 비전 모델로 충분하다 — 페이지마다 부르므로 단가가 그대로 총액이 된다
        model = blankToDefault(model, "gpt-4o-mini");
        maxPages = positiveOrDefault(maxPages, 30);
        // 긴 변 기준. 문서 글자는 이 정도면 읽히고, 더 키우면 토큰만 늘어난다
        maxImageWidth = positiveOrDefault(maxImageWidth, 1536);
        renderDpi = positiveOrDefault(renderDpi, 150);
        maxOutputTokens = positiveOrDefault(maxOutputTokens, 4096);
    }

    private static String blankToDefault(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value.strip();
    }

    private static int positiveOrDefault(int value, int defaultValue) {
        return value > 0 ? value : defaultValue;
    }

    private static long positiveOrDefault(long value, long defaultValue) {
        return value > 0 ? value : defaultValue;
    }
}
