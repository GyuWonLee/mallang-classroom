package com.mallang.file.tts;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * 로컬/개발용 TTS — 실제 음성 엔진 없이 짧은 '무음 WAV'를 만든다.
 * 버튼→생성→저장→스트리밍→재생 흐름을 키 없이 그대로 검증하기 위한 것. 기본 provider.
 */
@Component
@ConditionalOnProperty(name = "tts.provider", havingValue = "stub", matchIfMissing = true)
public class StubTtsProvider implements TtsProvider {

    private static final int SAMPLE_RATE = 8000;
    private static final double SECONDS = 0.4;

    @Override
    public SynthesizedAudio synthesize(String text, String voice) {
        return new SynthesizedAudio(silentWav(), "audio/wav", "wav");
    }

    @Override
    public String cacheNamespace() {
        return "stub";
    }

    // 8kHz mono 16-bit PCM 무음 WAV (헤더 44B + 0으로 채운 샘플)
    private byte[] silentWav() {
        int samples = (int) (SAMPLE_RATE * SECONDS);
        int dataBytes = samples * 2; // 16-bit
        ByteArrayOutputStream out = new ByteArrayOutputStream(44 + dataBytes);
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put("RIFF".getBytes());
        header.putInt(36 + dataBytes);
        header.put("WAVE".getBytes());
        header.put("fmt ".getBytes());
        header.putInt(16);              // fmt 청크 크기
        header.putShort((short) 1);     // PCM
        header.putShort((short) 1);     // 채널 1
        header.putInt(SAMPLE_RATE);
        header.putInt(SAMPLE_RATE * 2); // byte rate
        header.putShort((short) 2);     // block align
        header.putShort((short) 16);    // bits per sample
        header.put("data".getBytes());
        header.putInt(dataBytes);
        out.writeBytes(header.array());
        out.writeBytes(new byte[dataBytes]); // 무음
        return out.toByteArray();
    }
}
