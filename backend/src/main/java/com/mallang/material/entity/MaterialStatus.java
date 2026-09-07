package com.mallang.material.entity;

/**
 * 학습자료 상태 머신 (명세 §6.5): PROCESSING → PREVIEW → READY / FAILED.
 *
 * PREVIEW 를 반드시 거치는 이유: 손글씨·저화질 스캔은 추출이 깨질 수 있어
 * 선생님이 눈으로 확인한 뒤에만 생성에 쓰게 한다.
 */
public enum MaterialStatus {
    PROCESSING,
    PREVIEW,
    READY,
    FAILED;

    /** AI 과제 생성에 쓸 수 있는가 — READY 가 아니면 409 */
    public boolean usableForGeneration() {
        return this == READY;
    }
}
