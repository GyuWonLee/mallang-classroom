package com.mallang.material.repository;

/**
 * 답변 근거로 쓸 자료 본문 — 파일·업로더·학급 연관까지 끌고 오지 않는다.
 *
 * @see MaterialTitleView 왜 엔티티 대신 투영으로 읽는지
 */
public record MaterialTextView(Long id, String title, String extractedText) {
}
