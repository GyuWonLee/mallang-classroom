package com.mallang.assignment.ai;

import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;

import java.util.List;

/**
 * LLM 생성 입력 — 자료는 이미 resolve/검증되어 grounding 텍스트를 담고 있다.
 * focusTags: 비어있지 않으면 그 개념(약점) 위주로 출제 — 오답 클리닉/개인 최적화(§8)에서 사용.
 * level: null 이 아니면 그 목표 난이도(1=기초·2=기본·3=심화) 위주로 출제 — 실력 맞춤 추천(§8 3-d, 이슈 76).
 * expandFromScope: true면 자료를 출제 근거가 아니라 <b>주제·개념 '범위'</b>로만 쓰고, 그 범위 안에서
 *   학년 수준에 맞는 <b>새 예문·상황을 만들어</b> 출제한다(엄격 grounding 완화). 오답 클리닉의 약점
 *   보강처럼 '같은 지문 재인용'이 아니라 '새 연습문제'가 필요한 곳에서 쓴다. 기본은 false(엄격).
 */
public record GenerationCommand(
        Subject subject,
        AssignmentType type,
        int grade,
        int count,
        List<ResolvedMaterial> materials,
        List<String> focusTags,
        Integer level,
        boolean expandFromScope
) {
    public GenerationCommand(Subject subject, AssignmentType type, int grade, int count,
                             List<ResolvedMaterial> materials) {
        this(subject, type, grade, count, materials, List.of(), null, false);
    }

    public GenerationCommand(Subject subject, AssignmentType type, int grade, int count,
                             List<ResolvedMaterial> materials, List<String> focusTags) {
        this(subject, type, grade, count, materials, focusTags, null, false);
    }

    public GenerationCommand(Subject subject, AssignmentType type, int grade, int count,
                             List<ResolvedMaterial> materials, List<String> focusTags, Integer level) {
        this(subject, type, grade, count, materials, focusTags, level, false);
    }

    /**
     * 같은 요청을 <b>범위 모드</b>로 바꾼 사본.
     *
     * <p>엄격 인용(기본)으로 "문항을 만들 수 있는 내용이 아니다"라는 판정을 받았을 때 한 번 더
     * 시도하는 데 쓴다. 선생님이 올리는 자료는 읽기 지문만이 아니라 <b>빈칸 학습지</b>인 경우가
     * 많은데, 학습지는 문장마다 답이 비어 있어("6 ÷ 2 =      입니다") 그대로 인용해도 정답이
     * 확정되지 않는다 — 엄격 모드 규칙상 만들 수 있는 문항이 하나도 없다.</p>
     */
    public GenerationCommand expandingFromScope() {
        return new GenerationCommand(subject, type, grade, count, materials, focusTags, level, true);
    }
}
