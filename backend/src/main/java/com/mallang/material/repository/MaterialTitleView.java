package com.mallang.material.repository;

/**
 * 학습자료의 제목만 — 말랑이 프롬프트에 실을 목록용.
 *
 * <p>{@code material.extracted_text} 는 상한 없는 {@code text} 컬럼이다. PDF 한 권이면 수십만
 * 자가 들어가는데, 지금까지는 <b>제목 두 개를 프롬프트에 싣겠다고 학급의 모든 자료 본문을</b>
 * 엔티티로 힙에 올렸다. 자료가 쌓일수록 질문 한 번이 GC 를 밀어 올린다. 그래서 투영으로 읽는다.
 */
public record MaterialTitleView(Long id, String title) {
}
