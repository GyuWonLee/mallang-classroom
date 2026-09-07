package com.mallang.file.entity;

import java.util.Set;

/**
 * 파일 용도. 용도마다 허용 타입·크기가 다르다 (명세 §9).
 * LEARNING_MATERIAL 은 POST /files 로 직접 못 올린다 — 추출 파이프라인을 타야 하므로
 * 학습자료 API(§6.5)만 생성할 수 있다.
 */
public enum FilePurpose {

    /** 받아쓰기 문항 음성 (서버가 TTS 로 생성) */
    TTS_AUDIO(Set.of("audio/"), 10),
    /** 학생 말하기 녹음·선생님 직접 녹음 */
    RECORDING(Set.of("audio/"), 10),
    /** 화이트보드 배경 이미지 */
    BOARD_IMAGE(Set.of("image/"), 10),
    /** 학습자료 PDF — §6.5 경유로만 */
    LEARNING_MATERIAL(Set.of("application/pdf"), 20);

    private final Set<String> allowedContentTypePrefixes;
    private final int maxSizeMb;

    FilePurpose(Set<String> allowedContentTypePrefixes, int maxSizeMb) {
        this.allowedContentTypePrefixes = allowedContentTypePrefixes;
        this.maxSizeMb = maxSizeMb;
    }

    public boolean allows(String contentType) {
        if (contentType == null) {
            return false;
        }
        String lower = contentType.toLowerCase();
        return allowedContentTypePrefixes.stream().anyMatch(lower::startsWith);
    }

    public long maxSizeBytes() {
        return (long) maxSizeMb * 1024 * 1024;
    }

    public int maxSizeMb() {
        return maxSizeMb;
    }

    /** 업로드 API(POST /files)로 직접 올릴 수 있는 용도인가 */
    public boolean directlyUploadable() {
        return this != LEARNING_MATERIAL;
    }
}
