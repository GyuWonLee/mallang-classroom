package com.mallang.tutor.entity;

/** 제안 액션의 상태. 만료는 상태로 저장하지 않고 조회 시점에 판정한다(V18 주석 참고). */
public enum TutorActionStatus {
    PENDING,
    CONFIRMED,
    REJECTED
}
