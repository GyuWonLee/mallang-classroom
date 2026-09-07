package com.mallang.classroom.entity;

/**
 * 학급 내 권한 (USER.role과 별개).
 * 권한 검증은 항상 이 멤버십 역할 기준 — User에 역할을 두지 않는다 (설계 원칙).
 */
public enum ClassroomRole {
    OWNER, MAINTAINER, STUDENT;

    public boolean canManage() {
        return this == OWNER || this == MAINTAINER;
    }
}
