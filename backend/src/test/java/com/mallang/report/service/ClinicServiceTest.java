package com.mallang.report.service;

import com.mallang.assignment.ai.GenerationCommand;
import com.mallang.assignment.ai.ResolvedMaterial;
import com.mallang.assignment.dto.AssignmentDtos.GenerateAccepted;
import com.mallang.assignment.entity.AssignmentType;
import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.material.MaterialSource;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.assignment.service.GenerationJob;
import com.mallang.assignment.service.GenerationJobRunner;
import com.mallang.assignment.service.GenerationJobStore;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.material.repository.MaterialRepository;
import com.mallang.material.repository.MaterialTitleView;
import com.mallang.report.service.ReportService.Aggregation;
import com.mallang.report.service.ReportService.Recommendation;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 오답 클리닉 — 약점 개념으로 보강 문제를 만드는 비동기 생성.
 *
 * <p>여기서 중요한 것은 생성기에 <b>무엇을 넘기는가</b>다. 약점 태그와 추천 난이도가 빠지면
 * 그냥 일반 문제가 나오고, 학년이 틀리면 grounding 자료가 어긋나 모르는 낱말이 섞인다.</p>
 */
@ExtendWith(MockitoExtension.class)
class ClinicServiceTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long STUDENT_ID = 20L;

    @Mock ReportService reportService;
    @Mock MaterialSource materialSource;
    @Mock MaterialRepository materialRepository;
    @Mock GenerationJobStore jobStore;
    @Mock GenerationJobRunner runner;
    @Mock AssignmentAccessGuard accessGuard;
    @Mock UserRepository userRepository;
    @InjectMocks ClinicService service;

    @Test
    void feedsWeakTagsAndRecommendedLevelIntoTheGenerator() {
        weaknesses("받침규칙", "조사 을/를");
        student(2);
        recommend(3);
        materials();

        GenerateAccepted accepted = service.startClinic(
                teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null);

        assertThat(accepted.jobId()).startsWith("gen-");
        GenerationCommand command = capturedCommand();
        // 개인화의 전부가 이 두 값이다 — 빠지면 그냥 일반 문제가 나온다
        assertThat(command.focusTags()).containsExactly("받침규칙", "조사 을/를");
        assertThat(command.level()).isEqualTo(3);
        assertThat(command.grade()).isEqualTo(2);
    }

    @Test
    void defaultsToFiveMultipleChoiceQuestions() {
        weaknesses("받침규칙");
        student(2);
        recommend(2);
        materials();

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null);

        GenerationCommand command = capturedCommand();
        assertThat(command.count()).isEqualTo(5);
        assertThat(command.type()).isEqualTo(AssignmentType.MULTIPLE_CHOICE);
    }

    @Test
    void honoursExplicitTypeAndCount() {
        weaknesses("받침규칙");
        student(2);
        recommend(2);
        materials();

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, AssignmentType.OX, 8, null);

        GenerationCommand command = capturedCommand();
        assertThat(command.type()).isEqualTo(AssignmentType.OX);
        assertThat(command.count()).isEqualTo(8);
    }

    @Test
    void zeroOrNegativeCountFallsBackToTheDefault() {
        weaknesses("받침규칙");
        student(2);
        recommend(2);
        materials();

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, null, 0, null);

        assertThat(capturedCommand().count()).isEqualTo(5);
    }

    @Test
    void fallsBackToBuiltinVocabularyWhenNoUploadedMaterials() {
        weaknesses("받침규칙");
        student(3);
        recommend(2);
        materials();
        when(materialRepository.findReadyTitles(CLASSROOM_ID)).thenReturn(List.of()); // 올린 자료 없음

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null);

        // 올린 자료가 없을 때만 내장 어휘로 폴백 — 학년이 틀리면 모르는 낱말이 섞인 문제가 나간다
        ArgumentCaptor<List<String>> sources = ArgumentCaptor.forClass(List.class);
        verify(materialSource).resolve(eq(CLASSROOM_ID), sources.capture());
        assertThat(sources.getValue()).containsExactly("builtin-korean-g3");
    }

    @Test
    void teacherSuppliedMaterialsWinOverTheBuiltinOnes() {
        weaknesses("받침규칙");
        student(2);
        recommend(2);
        materials();

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, null, null, List.of("mat-9"));

        ArgumentCaptor<List<String>> sources = ArgumentCaptor.forClass(List.class);
        verify(materialSource).resolve(eq(CLASSROOM_ID), sources.capture());
        assertThat(sources.getValue()).containsExactly("mat-9");
    }

    @Test
    void groundsOnUploadedReadyMaterialsWhenTeacherPicksNone() {
        // 자료를 안 골라도, 학급에 올린 READY 자료가 있으면 그걸로 grounding 한다
        // (약점 태그가 그 자료 안에서 초점을 잡는다). 내장 어휘가 아니라 올린 자료를 쓴다.
        weaknesses("받침규칙");
        student(3);
        recommend(2);
        materials();
        when(materialRepository.findReadyTitles(CLASSROOM_ID)).thenReturn(List.of(
                new MaterialTitleView(7L, "3학년 국어 지문"),
                new MaterialTitleView(9L, "받아쓰기 자료")));

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null);

        ArgumentCaptor<List<String>> sources = ArgumentCaptor.forClass(List.class);
        verify(materialSource).resolve(eq(CLASSROOM_ID), sources.capture());
        assertThat(sources.getValue()).containsExactly("7", "9");
    }

    @Test
    void aStudentWithNoWeaknessesNeedsNoClinic() {
        Aggregation agg = mock(Aggregation.class);
        when(agg.weaknesses()).thenReturn(List.of());
        when(reportService.aggregate(CLASSROOM_ID, STUDENT_ID)).thenReturn(agg);

        assertThatThrownBy(() -> service.startClinic(
                teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("약점으로 판단된 개념이 없어");

        // 만들 게 없으면 크레딧도 쓰지 않는다
        verify(runner, never()).run(any(), any());
    }

    @Test
    void unknownStudentIs404() {
        weaknesses("받침규칙");
        when(userRepository.findById(STUDENT_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.startClinic(
                teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학생을 찾을 수 없습니다");
    }

    @Test
    void studentWithoutAGradeCannotBeGrounded() {
        weaknesses("받침규칙");
        student(null);

        // 학년이 없으면 어느 자료를 붙일지 정할 수 없다 — 아무거나 붙이면 커리큘럼을 벗어난다
        assertThatThrownBy(() -> service.startClinic(
                teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학년 정보가 없어");
    }

    @Test
    void theJobIsStoredBeforeItRuns() {
        weaknesses("받침규칙");
        student(2);
        recommend(2);
        materials();

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null);

        // 저장이 늦으면 폴링이 "없는 작업"을 만난다 — 비동기 실행보다 먼저여야 한다
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(jobStore, runner);
        order.verify(jobStore).save(any(GenerationJob.class));
        order.verify(runner).run(any(), any());
    }

    /**
     * 보강 문제의 과목은 <b>오답이 나온 과제</b>를 따라간다.
     *
     * <p>예전에는 Subject.KOREAN 이 그냥 박혀 있어, 수학에서 틀려서 만든 보강 문제까지 국어로
     * 저장됐다. 목록에서 과목이 거짓말을 하고, 과목별로 세는 곳마다 그 문제가 빠진다.</p>
     */
    @Test
    void theClinicTakesItsSubjectFromWhereTheStudentGotThingsWrong() {
        weaknesses("곱셈");
        student(3);
        recommend(2);
        materials();
        when(reportService.weakestSubject(CLASSROOM_ID, STUDENT_ID)).thenReturn(Subject.MATH);

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null);

        assertThat(capturedCommand().subject()).isEqualTo(Subject.MATH);
    }

    /** 채점된 제출이 아직 없으면 과목을 정할 수 없다 — 그때만 국어로 둔다. */
    @Test
    void fallsBackToKoreanWhenNoGradedWorkTellsUsTheSubject() {
        weaknesses("받침규칙");
        student(2);
        recommend(2);
        materials();
        when(reportService.weakestSubject(CLASSROOM_ID, STUDENT_ID)).thenReturn(null);

        service.startClinic(teacher(), CLASSROOM_ID, STUDENT_ID, null, null, null);

        assertThat(capturedCommand().subject()).isEqualTo(Subject.KOREAN);
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private GenerationCommand capturedCommand() {
        ArgumentCaptor<GenerationCommand> captor =
                ArgumentCaptor.forClass(GenerationCommand.class);
        verify(runner).run(any(GenerationJob.class), captor.capture());
        return captor.getValue();
    }

    private void weaknesses(String... tags) {
        Aggregation agg = mock(Aggregation.class);
        lenient().when(agg.weaknesses()).thenReturn(List.of(tags));
        lenient().when(reportService.aggregate(CLASSROOM_ID, STUDENT_ID)).thenReturn(agg);
    }

    private void recommend(int generationLevel) {
        Recommendation rec = mock(Recommendation.class);
        lenient().when(rec.generationLevel()).thenReturn(generationLevel);
        lenient().when(reportService.recommend(any())).thenReturn(rec);
    }

    private void student(Integer grade) {
        User user = mock(User.class);
        lenient().when(user.getGrade()).thenReturn(grade == null ? null : grade.shortValue());
        Optional<User> found = Optional.of(user);
        lenient().when(userRepository.findById(STUDENT_ID)).thenReturn(found);
    }

    private void materials() {
        List<ResolvedMaterial> resolved =
                List.of(new ResolvedMaterial("builtin", "어휘", "학교에 갔다."));
        lenient().when(materialSource.resolve(any(), any())).thenReturn(resolved);
    }

    private AuthUser teacher() {
        return new AuthUser(1L, Role.TEACHER, "김선생");
    }
}
