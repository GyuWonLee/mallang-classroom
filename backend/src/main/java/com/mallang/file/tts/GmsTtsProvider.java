package com.mallang.file.tts;

import com.mallang.global.http.ExternalHttpClients;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import java.time.Duration;

/**
 * OpenAI 호환 음성 API(SSAFY GMS 중계)로 TTS 생성. tts.provider=gms 일 때 활성화.
 * POST {base-url}{speech-path} (예: https://gms.ssafy.io/gmsapi/api.openai.com/v1/audio/speech)
 * — Authorization: Bearer {GMS 키}, 응답은 오디오 바이트(mp3 등) 그대로.
 */
@Component
@ConditionalOnProperty(name = "tts.provider", havingValue = "gms")
public class GmsTtsProvider implements TtsProvider {

    private final RestClient rest;
    private final TtsProperties.Gms gms;

    public GmsTtsProvider(TtsProperties properties) {
        this.gms = properties.gms();
        // 음성 합성 — 문장 길이에 비례한다. 학생이 재생 버튼을 누르고 기다리는 시간이다.
        this.rest = RestClient.builder()
                .requestFactory(ExternalHttpClients.factory(Duration.ofSeconds(30)))
                .baseUrl(gms.baseUrl())
                .defaultHeader("Authorization", "Bearer " + gms.apiKey())
                .build();
    }

    @Override
    public SynthesizedAudio synthesize(String text, String voice) {
        String format = gms.format() != null ? gms.format() : "mp3";
        Map<String, Object> body = Map.of(
                "model", gms.model(),
                "input", text,
                "voice", voice != null ? voice : gms.voice(),
                "response_format", format);

        ResponseEntity<byte[]> response = rest.post()
                .uri(gms.speechPath())
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .toEntity(byte[].class);

        byte[] audio = response.getBody();
        if (audio == null || audio.length == 0) {
            throw new IllegalStateException("TTS 게이트웨이가 빈 응답을 반환했습니다.");
        }
        // 일부 게이트웨이는 오류를 200 + JSON/텍스트로 돌려준다 — 오디오가 아니면 파일로 남기지 않고 명확히 실패시킨다.
        MediaType ct = response.getHeaders().getContentType();
        boolean notAudio = (ct != null && !"audio".equalsIgnoreCase(ct.getType())) || looksLikeText(audio);
        if (notAudio) {
            String preview = new String(audio, 0, Math.min(audio.length, 400), StandardCharsets.UTF_8);
            throw new IllegalStateException("TTS 게이트웨이가 오디오가 아닌 응답을 반환했습니다"
                    + (ct != null ? " (Content-Type=" + ct + ")" : "") + ": " + preview);
        }
        return new SynthesizedAudio(audio, contentType(format), format);
    }

    @Override
    public String cacheNamespace() {
        return "gms:" + gms.model() + ":" + gms.voice();
    }

    // 첫 비공백 바이트가 '{' 또는 '[' 면 JSON(에러)일 가능성 — 오디오 매직바이트가 아님
    private boolean looksLikeText(byte[] data) {
        for (byte b : data) {
            if (b == ' ' || b == '\n' || b == '\r' || b == '\t') {
                continue;
            }
            return b == '{' || b == '[';
        }
        return false;
    }

    private String contentType(String format) {
        return switch (format) {
            case "mp3" -> "audio/mpeg";
            case "wav" -> "audio/wav";
            case "opus" -> "audio/opus";
            case "aac" -> "audio/aac";
            case "flac" -> "audio/flac";
            default -> "application/octet-stream";
        };
    }
}
