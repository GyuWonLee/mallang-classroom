package com.mallang.material.repository;

import com.mallang.classroom.entity.Classroom;
import com.mallang.file.entity.FilePurpose;
import com.mallang.file.entity.UploadedFile;
import com.mallang.global.config.JpaConfig;
import com.mallang.material.entity.ExtractionSource;
import com.mallang.material.entity.Material;
import com.mallang.user.entity.User;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 말랑이가 아이에게 <b>보여 주는</b> 자료와 <b>인용하는</b> 자료의 범위를 고정한다.
 *
 * <p>상태 머신이 PREVIEW 단계를 두는 이유는 "손글씨·저화질 스캔은 추출이 깨질 수 있으니
 * 선생님이 눈으로 확인한 뒤에만 쓴다"이다. 그런데 답변 근거를 고르는 경로는 그 관문을
 * 지나쳐, 본문만 있으면 PREVIEW·FAILED 자료의 문장도 아이 답변에 인용했다.
 * 목록 경로에는 READY 필터가 있고 근거 경로에는 없던 셈이라, 두 기준을 여기서 맞춰 둔다.
 *
 * <p>필터를 자바가 아니라 쿼리로 내렸으므로 목이 아닌 실제 DB 위에서 검증한다.
 */
@DataJpaTest
@Import(JpaConfig.class)
@TestPropertySource(properties = {
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false"
})
class MaterialReadyScopeTest {

    @PersistenceContext
    EntityManager em;

    @Autowired
    MaterialRepository materialRepository;

    @Test
    @DisplayName("선생님이 확인한 자료만 말랑이 목록에 오른다")
    void onlyConfirmedMaterialsAreOfferable() {
        Classroom classroom = classroom();
        material(classroom, "확인된 자료", true, "받침은 글자 아래 자음이에요.");
        material(classroom, "선생님 확인 대기", false, "받침은 글자 아래 자음이에요.");
        materialFailed(classroom, "추출 실패");
        materialProcessing(classroom, "추출 중");
        em.flush();
        em.clear();

        assertThat(materialRepository.findReadyTitles(classroom.getId()))
                .extracting(MaterialTitleView::title)
                .containsExactly("확인된 자료");
    }

    @Test
    @DisplayName("답변 근거도 확인된 자료에서만 가져온다")
    void groundingReadsOnlyConfirmedMaterials() {
        Classroom classroom = classroom();
        material(classroom, "확인된 자료", true, "받침은 글자 아래 자음이에요.");
        material(classroom, "미확인 자료", false, "이 문장은 아직 검수되지 않았어요.");
        em.flush();
        em.clear();

        assertThat(materialRepository.findReadyTexts(classroom.getId()))
                .extracting(MaterialTextView::extractedText)
                .containsExactly("받침은 글자 아래 자음이에요.");
    }

    @Test
    @DisplayName("본문이 없는 자료는 근거 후보에 들지 않는다")
    void materialsWithoutTextAreNotGroundingCandidates() {
        Classroom classroom = classroom();
        material(classroom, "본문 없는 확인 자료", true, null);
        em.flush();
        em.clear();

        assertThat(materialRepository.findReadyTexts(classroom.getId())).isEmpty();
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private Classroom classroom() {
        Classroom classroom = Classroom.create("3학년 2반", "dodam" + System.nanoTime(),
                List.of((short) 3));
        em.persist(classroom);
        em.flush();
        return classroom;
    }

    private void material(Classroom classroom, String title, boolean confirmed, String text) {
        Material material = Material.uploading(classroom, file(), title);
        if (text != null) {
            material.previewReady(text, ExtractionSource.TEXT_LAYER);
        }
        if (confirmed) {
            material.confirm();
        }
        em.persist(material);
    }

    private void materialFailed(Classroom classroom, String title) {
        Material material = Material.uploading(classroom, file(), title);
        material.fail("스캔 품질이 낮아 글자를 읽지 못했어요");
        em.persist(material);
    }

    private void materialProcessing(Classroom classroom, String title) {
        em.persist(Material.uploading(classroom, file(), title));
    }

    private UploadedFile file() {
        User uploader = User.createTeacher("t" + System.nanoTime() + "@school.kr",
                "encoded", "이선생", "싸피초등학교");
        em.persist(uploader);
        UUID id = UUID.randomUUID();
        UploadedFile file = UploadedFile.of(id, uploader, FilePurpose.LEARNING_MATERIAL,
                "자료.pdf", "material/2026/08/" + id + ".pdf", "application/pdf", 1024);
        em.persist(file);
        return file;
    }
}
