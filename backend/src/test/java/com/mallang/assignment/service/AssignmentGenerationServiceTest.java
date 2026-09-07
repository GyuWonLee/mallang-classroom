package com.mallang.assignment.service;

import com.mallang.assignment.ai.ResolvedMaterial;
import com.mallang.assignment.dto.AssignmentDtos.GenerateRequest;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.material.MaterialSource;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI 생성 진입 규칙 — 받아쓰기는 국어·영어에서만 만들 수 있다(다른 과목엔 '듣고 받아쓰기'가 성립하지 않음).
 */
@ExtendWith(MockitoExtension.class)
class AssignmentGenerationServiceTest {

    @Mock AssignmentAccessGuard accessGuard;
    @Mock MaterialSource materialSource;
    @Mock GenerationJobStore jobStore;
    @Mock GenerationJobRunner runner;
    @InjectMocks AssignmentGenerationService service;

    private final AuthUser teacher = new AuthUser(1L, Role.TEACHER);

    @Test
    void dictationRejectedForNonKoreanEnglishSubject() {
        GenerateRequest req = new GenerateRequest(
                Subject.MATH, AssignmentType.DICTATION, 2, 3, List.of("builtin-korean-g2"));

        assertThatThrownBy(() -> service.startGeneration(teacher, 10L, req))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("받아쓰기는 국어·영어");

        verify(runner, never()).run(any(), any()); // 생성 자체가 시작되면 안 된다
    }

    @Test
    void dictationAllowedForEnglish() {
        when(materialSource.resolve(eq(10L), any()))
                .thenReturn(List.of(new ResolvedMaterial("m-1", "영어 자료", "apple banana")));
        GenerateRequest req = new GenerateRequest(
                Subject.ENGLISH, AssignmentType.DICTATION, 2, 3, List.of("m-1"));

        service.startGeneration(teacher, 10L, req);

        verify(runner).run(any(), any());
    }

    @Test
    void nonDictationTypeIsUnaffectedBySubject() {
        when(materialSource.resolve(eq(10L), any()))
                .thenReturn(List.of(new ResolvedMaterial("m-1", "수학 자료", "1+1=2")));
        GenerateRequest req = new GenerateRequest(
                Subject.MATH, AssignmentType.MULTIPLE_CHOICE, 2, 3, List.of("m-1"));

        service.startGeneration(teacher, 10L, req); // 수학+객관식은 허용

        verify(runner).run(any(), any());
    }
}
