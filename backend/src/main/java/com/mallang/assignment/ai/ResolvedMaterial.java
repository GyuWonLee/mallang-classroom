package com.mallang.assignment.ai;

/**
 * 생성의 grounding 원천 — 학습자료 1건의 추출 텍스트.
 * 내장 어휘 자료(builtin-korean-g{n})는 서버 리소스에서, 향후 업로드 자료는 MATERIAL 테이블에서 채운다.
 */
public record ResolvedMaterial(String materialId, String title, String text) {
}
