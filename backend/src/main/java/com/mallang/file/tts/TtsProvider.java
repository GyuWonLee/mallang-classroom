package com.mallang.file.tts;

/**
 * 텍스트→음성 provider 추상화. 구현 교체(stub ↔ GMS)는 tts.provider 설정으로.
 * cacheNamespace는 중복제거 키에 섞여, provider/모델/음성이 바뀌면 다른 파일로 취급되게 한다.
 */
public interface TtsProvider {

    SynthesizedAudio synthesize(String text, String voice);

    /** 캐시 네임스페이스 (예: "gms:tts-1", "stub"). */
    String cacheNamespace();

    record SynthesizedAudio(byte[] data, String contentType, String extension) {
    }
}
