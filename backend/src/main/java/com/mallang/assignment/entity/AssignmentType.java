package com.mallang.assignment.entity;

/**
 * 문제 유형. content(JSONB) 스키마가 유형별로 다르다.
 * QUIZ_GAME은 별도 문항 스키마 없이 OX·객관식 문항을 게임 UI로 푸는 표시 모드 (명세 §7).
 */
public enum AssignmentType {
    DICTATION, MULTIPLE_CHOICE, PARTICLE_CHOICE, OX, QUIZ_GAME
}
