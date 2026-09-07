package com.mallang.assignment.ai;

/**
 * AI 과제 생성 provider 추상화. 구현 교체(stub ↔ Claude)는 ai.provider 설정으로.
 * 반드시 자료(grounding) 기반으로만 생성하며, 문항마다 근거 원문을 인용해야 한다 (명세 §7).
 */
public interface AssignmentGenerator {

    GeneratedAssignment generate(GenerationCommand command);
}
