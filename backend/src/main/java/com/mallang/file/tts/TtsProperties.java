package com.mallang.file.tts;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** tts.* 설정. provider=stub(기본) | gms. */
@ConfigurationProperties(prefix = "tts")
public record TtsProperties(
        String provider,
        int maxChars,
        Gms gms
) {
    /** OpenAI 호환 음성 API (SSAFY GMS의 OpenAI 중계). */
    public record Gms(String apiKey, String baseUrl, String speechPath, String model,
                      String voice, String format) {
    }
}
