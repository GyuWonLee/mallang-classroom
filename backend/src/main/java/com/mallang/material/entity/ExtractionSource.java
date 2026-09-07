package com.mallang.material.entity;

/** 추출 경로 (명세 §6.5 2단계 추출) — 미리보기 안내와 품질 판단의 근거 */
public enum ExtractionSource {
    /** 1단계: PDF 텍스트 레이어 (즉시·무료). 한글/워드에서 내보낸 PDF는 여기서 끝난다 */
    TEXT_LAYER,
    /** 2단계: 멀티모달 LLM (스캔본·이미지 PDF). API 키 확보 후 도입 */
    LLM
}
