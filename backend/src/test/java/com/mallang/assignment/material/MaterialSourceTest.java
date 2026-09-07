package com.mallang.assignment.material;

import com.mallang.assignment.ai.AiProperties;
import com.mallang.assignment.ai.ResolvedMaterial;
import com.mallang.classroom.entity.Classroom;
import com.mallang.global.error.ApiException;
import com.mallang.material.entity.Material;
import com.mallang.material.entity.MaterialStatus;
import com.mallang.material.repository.MaterialRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MaterialSourceTest {

    @Mock MaterialRepository materialRepository;

    private MaterialSource source() {
        return new MaterialSource(materialRepository, new AiProperties("stub", null, null, null, null));
    }

    @Test
    void resolvesBuiltinKoreanMaterial() {
        List<ResolvedMaterial> resolved = source().resolve(10L, List.of("builtin-korean-g2"));

        assertThat(resolved).hasSize(1);
        assertThat(resolved.get(0).materialId()).isEqualTo("builtin-korean-g2");
        assertThat(resolved.get(0).text()).contains("학교에 갔다");
    }

    @Test
    void resolvesUploadedReadyMaterial() {
        Material m = material(10L, MaterialStatus.READY, "동시 한 편을 읽었다.", "3학년 국어 지문");
        when(materialRepository.findById(123L)).thenReturn(Optional.of(m));

        List<ResolvedMaterial> resolved = source().resolve(10L, List.of("123"));

        assertThat(resolved).hasSize(1);
        assertThat(resolved.get(0).materialId()).isEqualTo("123");
        assertThat(resolved.get(0).title()).isEqualTo("3학년 국어 지문");
        assertThat(resolved.get(0).text()).isEqualTo("동시 한 편을 읽었다.");
    }

    @Test
    void resolvesMixedBuiltinAndUploaded() {
        Material m = material(10L, MaterialStatus.READY, "지문 텍스트", "업로드 자료");
        when(materialRepository.findById(123L)).thenReturn(Optional.of(m));

        List<ResolvedMaterial> resolved = source().resolve(10L, List.of("builtin-korean-g2", "123"));

        assertThat(resolved).extracting(ResolvedMaterial::materialId)
                .containsExactly("builtin-korean-g2", "123");
    }

    @Test
    void rejectsNonReadyUploadedWith409() {
        Material m = material(10L, MaterialStatus.PREVIEW, null, "처리 전 자료");
        when(materialRepository.findById(123L)).thenReturn(Optional.of(m));

        assertThatThrownBy(() -> source().resolve(10L, List.of("123")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void rejectsMaterialOfAnotherClassroomWith404() {
        Material m = material(99L, MaterialStatus.READY, "남의 학급 자료", "제목"); // 다른 학급(99) 소속
        when(materialRepository.findById(123L)).thenReturn(Optional.of(m));

        assertThatThrownBy(() -> source().resolve(10L, List.of("123")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void rejectsMissingUploadedWith404() {
        when(materialRepository.findById(123L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> source().resolve(10L, List.of("123")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void rejectsNonNumericNonBuiltinIdWith400() {
        assertThatThrownBy(() -> source().resolve(10L, List.of("uploaded-123")))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    // classroom 소속·상태·텍스트·제목만 스텁 (테스트별로 일부만 쓰이므로 lenient)
    /**
     * 스캔 학습지 한 권이면 추출 텍스트가 수만 자다. 그대로 프롬프트에 실으면 컨텍스트
     * 한계를 넘고, 게이트웨이 400 의 원본 응답이 job.error 를 타고 선생님 화면에 영어로 뜬다.
     */
    @Test
    void aHugeMaterialIsCutToTheLimit() {
        String huge = ("가나다라마바사아자차\n").repeat(2_000); // 22,000자
        Material m = material(10L, MaterialStatus.READY, huge, "스캔 학습지");
        when(materialRepository.findById(123L)).thenReturn(Optional.of(m));

        List<ResolvedMaterial> resolved = source().resolve(10L, List.of("123"));

        assertThat(resolved.get(0).text().length()).isLessThanOrEqualTo(20_000);
        // 문장 중간이 아니라 줄 경계에서 끊는다 — 잘린 조각이 문제로 나가지 않게
        assertThat(resolved.get(0).text()).endsWith("차");
    }

    /**
     * 자료를 여러 개 골라도 <b>하나도 빠지지 않는다.</b>
     *
     * <p>예전에는 앞에서부터 자료당 상한을 그대로 떼어 가서, 예산이 바닥나면 나머지가 통째로
     * 빠졌다 — 자료 6개를 고른 요청에서 5개가 제외되고 "문항을 만들 수 있는 내용이 아니다"로
     * 생성이 거절됐다. 선생님은 여섯 개를 골랐는데 하나로 만든 셈이었다.</p>
     */
    @Test
    void everyChosenMaterialGetsAShareOfTheBudget() {
        String big = ("가나다라마바사아자차\n").repeat(3_000); // 33,000자 — 각자 예산보다 크다
        // 목 생성이 when(...) 안에서 일어나면 스터빙이 중첩돼 Mockito 가 막는다 — 먼저 만든다
        List<Material> materials = List.of(
                material(10L, MaterialStatus.READY, big, "자료1"),
                material(10L, MaterialStatus.READY, big, "자료2"),
                material(10L, MaterialStatus.READY, big, "자료3"),
                material(10L, MaterialStatus.READY, big, "자료4"),
                material(10L, MaterialStatus.READY, big, "자료5"),
                material(10L, MaterialStatus.READY, big, "자료6"));
        for (int i = 0; i < materials.size(); i++) {
            when(materialRepository.findById((long) (i + 1)))
                    .thenReturn(Optional.of(materials.get(i)));
        }

        List<ResolvedMaterial> resolved =
                source().resolve(10L, List.of("1", "2", "3", "4", "5", "6"));

        // 여섯 개가 모두 살아 있고, 각자 내용을 싣는다
        assertThat(resolved).hasSize(6);
        assertThat(resolved).allSatisfy(r -> assertThat(r.text()).isNotEmpty());
        int total = resolved.stream().mapToInt(r -> r.text().length()).sum();
        assertThat(total).isLessThanOrEqualTo(60_000);
    }

    /**
     * 짧은 자료가 남긴 몫은 긴 자료가 쓴다 — 예산을 버리지 않는다.
     *
     * <p>단순히 N 등분하면 짧은 자료의 남는 몫이 그대로 사라져, 긴 자료가 필요 이상으로 잘린다.</p>
     */
    @Test
    void leftoverFromShortMaterialsGoesToTheLongOnes() {
        String tiny = "짧은 자료\n";
        String big = ("가나다라마바사아자차\n").repeat(6_000); // 66,000자
        List<Material> materials = List.of(
                material(10L, MaterialStatus.READY, tiny, "짧은 것"),
                material(10L, MaterialStatus.READY, big, "긴 것"));
        for (int i = 0; i < materials.size(); i++) {
            when(materialRepository.findById((long) (i + 1)))
                    .thenReturn(Optional.of(materials.get(i)));
        }

        List<ResolvedMaterial> resolved = source().resolve(10L, List.of("1", "2"));

        // 순서는 고른 순서 그대로 — 배분하려고 정렬한 것이 밖으로 새지 않는다
        assertThat(resolved.get(0).title()).isEqualTo("짧은 것");
        // 긴 자료가 절반(30,000)이 아니라 자료당 상한(20,000)까지 가져간다
        assertThat(resolved.get(1).text().length()).isGreaterThan(19_000);
    }

    private Material material(long classroomId, MaterialStatus status, String text, String title) {
        Material m = mock(Material.class);
        Classroom classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(classroomId);
        lenient().when(m.getClassroom()).thenReturn(classroom);
        lenient().when(m.getStatus()).thenReturn(status);
        lenient().when(m.getExtractedText()).thenReturn(text);
        lenient().when(m.getTitle()).thenReturn(title);
        return m;
    }
}
