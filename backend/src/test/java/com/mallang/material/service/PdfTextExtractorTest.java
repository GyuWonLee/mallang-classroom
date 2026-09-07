package com.mallang.material.service;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/** 추출 1단계 (PDF 텍스트 레이어) — S15P11A407-119 */
class PdfTextExtractorTest {

    @TempDir Path tmp;

    private final PdfTextExtractor extractor = new PdfTextExtractor(50);

    @Test
    void extractsTextLayerFromGeneratedPdf() throws Exception {
        // 한글/워드에서 내보낸 PDF 처럼 텍스트 레이어가 살아있는 문서
        Path pdf = pdfWithText(tmp.resolve("lesson.pdf"),
                "Chapter 1. The quick brown fox jumps over the lazy dog. "
                        + "Reading comprehension practice for grade three students today.");

        PdfTextExtractor.Result result = extractor.extract(pdf);

        assertThat(result.outcome()).isEqualTo(PdfTextExtractor.Outcome.EXTRACTED);
        assertThat(result.text()).contains("quick brown fox");
        assertThat(result.reason()).isNull();
    }

    @Test
    void treatsNearlyEmptyPdfAsScannedImage() throws Exception {
        // 스캔본은 글자가 거의 안 나온다 — 2단계(LLM) 로 넘길 대상
        Path pdf = pdfWithText(tmp.resolve("scan.pdf"), "p1");

        PdfTextExtractor.Result result = extractor.extract(pdf);

        assertThat(result.outcome()).isEqualTo(PdfTextExtractor.Outcome.SPARSE);
        assertThat(result.reason()).contains("스캔한 이미지 PDF");
    }

    @Test
    void emptyPageCountsAsSparseNotCrash() throws Exception {
        Path pdf = tmp.resolve("blank.pdf");
        try (PDDocument doc = new PDDocument()) {
            doc.addPage(new PDPage());
            doc.save(pdf.toFile());
        }

        PdfTextExtractor.Result result = extractor.extract(pdf);

        assertThat(result.outcome()).isEqualTo(PdfTextExtractor.Outcome.SPARSE);
    }

    @Test
    void corruptFileFailsWithReason() throws Exception {
        Path notPdf = tmp.resolve("broken.pdf");
        Files.writeString(notPdf, "이건 PDF 가 아니라 그냥 텍스트");

        PdfTextExtractor.Result result = extractor.extract(notPdf);

        assertThat(result.outcome()).isEqualTo(PdfTextExtractor.Outcome.FAILED);
        assertThat(result.reason()).contains("읽지 못했습니다");
        assertThat(result.text()).isNull();
    }

    /** 텍스트 레이어가 있는 PDF 를 만든다 (표준 폰트라 한글은 못 넣어 영문으로 검증) */
    private Path pdfWithText(Path target, String text) throws Exception {
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
}
