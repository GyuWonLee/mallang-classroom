package com.mallang.file.tts;

import com.mallang.file.tts.TtsProvider.SynthesizedAudio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * SSAFY GMS(OpenAI 호환)로 실제 TTS를 생성해 파일로 떨궈 눈(귀)으로 확인하는 스모크 테스트.
 * AI_OPENAI_API_KEY(=GMS 키) 가 있을 때만 실행. DB/스프링 불필요.
 *
 * 실행 (PowerShell):
 *   $env:AI_OPENAI_API_KEY = Read-Host "GMS 키"
 *   # 필요시: $env:TTS_GMS_MODEL="tts-1"; $env:TTS_GMS_VOICE="alloy"
 *   .\gradlew.bat cleanTest test --tests "*GmsTtsProviderLiveTest" --info
 * 생성된 mp3 경로가 출력되며, 그 파일을 재생해 한국어 음성을 확인하면 됩니다.
 */
@EnabledIfEnvironmentVariable(named = "AI_OPENAI_API_KEY", matches = ".+")
class GmsTtsProviderLiveTest {

    @Test
    void synthesizesKoreanSpeechViaGms() throws Exception {
        var env = System.getenv();
        TtsProperties.Gms gms = new TtsProperties.Gms(
                env.get("AI_OPENAI_API_KEY"),
                env.getOrDefault("AI_OPENAI_BASE_URL", "https://gms.ssafy.io/gmsapi/api.openai.com"),
                env.getOrDefault("TTS_GMS_SPEECH_PATH", "/v1/audio/speech"),
                env.getOrDefault("TTS_GMS_MODEL", "gpt-4o-mini-tts"),
                env.getOrDefault("TTS_GMS_VOICE", "alloy"),
                env.getOrDefault("TTS_GMS_FORMAT", "mp3"));

        GmsTtsProvider provider = new GmsTtsProvider(new TtsProperties("gms", 1000, gms));
        SynthesizedAudio audio = provider.synthesize("학교에 갔다.", null);

        assertThat(audio.data().length).isGreaterThan(0);

        Path out = Path.of("build", "tts-live-sample." + audio.extension());
        Files.createDirectories(out.getParent());
        Files.write(out, audio.data());

        System.out.println("\n===== GMS TTS 생성 완료 =====");
        System.out.println("형식: " + audio.contentType() + " / " + audio.data().length + " bytes");
        System.out.println("파일: " + out.toAbsolutePath() + "  ← 재생해서 확인하세요");
        System.out.println("=============================\n");
    }
}
