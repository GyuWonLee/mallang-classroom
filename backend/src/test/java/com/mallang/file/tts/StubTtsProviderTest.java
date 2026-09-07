package com.mallang.file.tts;

import com.mallang.file.tts.TtsProvider.SynthesizedAudio;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class StubTtsProviderTest {

    private final StubTtsProvider provider = new StubTtsProvider();

    @Test
    void producesPlayableSilentWav() {
        SynthesizedAudio audio = provider.synthesize("학교에 갔다", null);

        assertThat(audio.contentType()).isEqualTo("audio/wav");
        assertThat(audio.extension()).isEqualTo("wav");
        assertThat(audio.data().length).isGreaterThan(44); // 헤더 + 샘플
        // WAV 매직 바이트 RIFF....WAVE
        assertThat(new String(audio.data(), 0, 4, StandardCharsets.US_ASCII)).isEqualTo("RIFF");
        assertThat(new String(audio.data(), 8, 4, StandardCharsets.US_ASCII)).isEqualTo("WAVE");
    }
}
