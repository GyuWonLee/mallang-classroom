package com.mallang.assignment.entity;

/**
 * 과제 과목 — 국영수사과 5과목. 화면 표시·통지표 분류의 축이다.
 * label 은 화면·통지표에 그대로 쓰는 한글 과목명(프론트가 enum 을 몰라도 되게 함께 내려준다).
 */
public enum Subject {
    KOREAN("국어"),
    ENGLISH("영어"),
    MATH("수학"),
    SOCIAL("사회"),
    SCIENCE("과학");

    private final String label;

    Subject(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
