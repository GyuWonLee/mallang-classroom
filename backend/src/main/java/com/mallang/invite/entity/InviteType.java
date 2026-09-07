package com.mallang.invite.entity;

/**
 * 초대 종류. 기본 사용 횟수가 다르다.
 *
 * <p>TEACHER 는 <b>무제한</b>이다({@link #UNLIMITED}). 예전에는 1회였는데, 선생님을 한 명 더
 * 부를 때마다 링크를 새로 만들어야 했다 — 만들어서 보내 놓고 그 사이 다른 선생님이 먼저
 * 쓰면 뒤에 온 사람은 "만료된 초대"를 보게 된다. 링크는 학급 단톡방에 붙여 두고 오는 대로
 * 들어오는 물건이라, 한 번 쓰면 사라지는 쪽이 쓰임새와 어긋났다.</p>
 *
 * <p>무제한이어도 통제 수단은 남는다: 만료 시각(기본 48시간)과 회수 버튼이다.</p>
 */
public enum InviteType {
    /* 0 = UNLIMITED. enum 상수는 정적 필드를 앞서 참조할 수 없어 값을 그대로 적는다 */
    TEACHER(0),
    STUDENT(30);

    /** 사용 횟수 제한 없음 — 만료와 회수로만 닫는다 */
    public static final int UNLIMITED = 0;

    private final int defaultMaxUses;

    InviteType(int defaultMaxUses) {
        this.defaultMaxUses = defaultMaxUses;
    }

    public int defaultMaxUses() {
        return defaultMaxUses;
    }
}
