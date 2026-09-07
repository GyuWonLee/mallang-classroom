package com.mallang.material.service;

import com.mallang.file.service.FileStorage;
import com.mallang.material.entity.ExtractionSource;
import com.mallang.material.entity.Material;
import com.mallang.material.service.MaterialService.MaterialUploadedEvent;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 추출 파이프라인 1단계 → 2단계 승격 — S15P11A407-121 */
@ExtendWith(MockitoExtension.class)
class MaterialExtractionServiceTest {

    @Mock MaterialExtractionStore store;
    @Mock VisionTextExtractor visionTextExtractor;

    @TempDir Path mediaRoot;

    private FileStorage storage;
    private PdfTextExtractor pdfTextExtractor;

    @BeforeEach
    void setUp() {
        storage = new FileStorage(mediaRoot.toString());
        pdfTextExtractor = new PdfTextExtractor(50);
    }

    @Test
    void textPdfStopsAtStageOneAndNeverCallsLlm() throws Exception {
        givenStoredPdf(textPdf("Grade 3 reading practice. "
                + "The quick brown fox jumps over the lazy dog every single morning."));
        MaterialExtractionService service = serviceWith(Optional.of(visionTextExtractor));

        service.onMaterialUploaded(new MaterialUploadedEvent(1L));

        verify(store).applySuccess(eq(1L), any(), eq(ExtractionSource.TEXT_LAYER));
        // 1단계로 끝났으면 LLM 을 부르지 않는다 — 비용이 걸린 핵심 조건
        verify(visionTextExtractor, never()).extract(any());
    }

    @Test
    void scannedPdfIsPromotedToVision() throws Exception {
        givenStoredPdf(imageOnlyPdf());
        MaterialExtractionService service = serviceWith(Optional.of(visionTextExtractor));
        when(visionTextExtractor.extract(any()))
                .thenReturn(new VisionTextExtractor.Result("이미지에서 읽은 본문", null));

        service.onMaterialUploaded(new MaterialUploadedEvent(1L));

        verify(store).applySuccess(1L, "이미지에서 읽은 본문", ExtractionSource.LLM);
    }

    @Test
    void scannedPdfFailsGracefullyWithoutLlmConfigured() throws Exception {
        givenStoredPdf(imageOnlyPdf());
        // 키 미설정 환경 — 빈이 없다
        MaterialExtractionService service = serviceWith(Optional.empty());

        service.onMaterialUploaded(new MaterialUploadedEvent(1L));

        ArgumentCaptor<String> reason = ArgumentCaptor.forClass(String.class);
        verify(store).applyFailure(eq(1L), reason.capture());
        assertThat(reason.getValue()).contains("텍스트가 살아있는 PDF");
    }

    @Test
    void visionFailureKeepsMaterialFailedWithReason() throws Exception {
        givenStoredPdf(imageOnlyPdf());
        MaterialExtractionService service = serviceWith(Optional.of(visionTextExtractor));
        when(visionTextExtractor.extract(any()))
                .thenReturn(new VisionTextExtractor.Result(null, "이미지 판독 중 문제가 발생했습니다."));

        service.onMaterialUploaded(new MaterialUploadedEvent(1L));

        ArgumentCaptor<String> reason = ArgumentCaptor.forClass(String.class);
        verify(store).applyFailure(eq(1L), reason.capture());
        assertThat(reason.getValue()).contains("이미지 판독");
    }

    @Test
    void corruptPdfIsNotPromoted() throws Exception {
        Path broken = mediaRoot.resolve("broken.pdf");
        Files.writeString(broken, "not a pdf");
        givenStoredPdf(broken);
        MaterialExtractionService service = serviceWith(Optional.of(visionTextExtractor));

        service.onMaterialUploaded(new MaterialUploadedEvent(1L));

        verify(store).applyFailure(eq(1L), any());
        // 파일을 못 여는 건 이미지로도 못 읽는다 — 헛돈 쓰지 않는다
        verify(visionTextExtractor, never()).extract(any());
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private MaterialExtractionService serviceWith(Optional<VisionTextExtractor> vision) {
        return new MaterialExtractionService(storage, pdfTextExtractor, vision, store);
    }

    /**
     * 추출 결과는 이제 서비스가 엔티티를 직접 만지지 않고 {@link MaterialExtractionStore} 로
     * 넘긴다(트랜잭션을 추출 시간만큼 열어 두지 않기 위해). 그래서 테스트도 "엔티티 상태"가
     * 아니라 "무엇을 넘겼는지"를 본다.
     */
    private void givenStoredPdf(Path pdf) {
        String key = mediaRoot.relativize(pdf).toString().replace('\\', '/');
        when(store.readStorageKey(1L)).thenReturn(key);
    }

    private Path textPdf(String text) throws Exception {
        Path target = mediaRoot.resolve("text.pdf");
        try (PDDocument doc = new PDDocument()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            try (PDPageContentStream content = new PDPageContentStream(doc, page)) {
                content.beginText();
                content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                content.newLineAtOffset(50, 700);
                content.showText(text);
                content.endText();
            }
            doc.save(target.toFile());
        }
        return target;
    }

    /** 글자 없는 페이지 = 복사기로 스캔한 PDF 와 같은 상태 */
    private Path imageOnlyPdf() throws Exception {
        Path target = mediaRoot.resolve("scan.pdf");
        try (PDDocument doc = new PDDocument()) {
            doc.addPage(new PDPage());
            doc.save(target.toFile());
        }
        return target;
    }
}
