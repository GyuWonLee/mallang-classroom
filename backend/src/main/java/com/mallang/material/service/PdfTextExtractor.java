package com.mallang.material.service;

import lombok.extern.slf4j.Slf4j;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Path;

/**
 * 추출 1단계 — PDF 텍스트 레이어 (명세 §6.5).
 * 한글/워드에서 내보낸 PDF 는 여기서 끝난다. 즉시·무료·오프라인이라 LLM 을 항상 태우지 않는다.
 *
 * 스캔본(이미지만 있는 PDF)은 글자가 거의 안 나오므로 SPARSE 로 판정해 2단계(LLM)로 넘길 대상임을
 * 알린다. 2단계가 아직 없으므로 호출자가 FAILED 로 처리한다.
 */
@Slf4j
@Component
public class PdfTextExtractor {

    private final int minCharsPerPage;

    public PdfTextExtractor(@Value("${mallang.material.min-chars-per-page:50}") int minCharsPerPage) {
        this.minCharsPerPage = minCharsPerPage;
    }

    public Result extract(Path pdf) {
        try (PDDocument document = Loader.loadPDF(pdf.toFile())) {
            if (document.isEncrypted()) {
                return Result.failed("암호가 걸린 PDF는 읽을 수 없습니다.");
            }
            int pages = document.getNumberOfPages();
            if (pages == 0) {
                return Result.failed("페이지가 없는 PDF입니다.");
            }
            String text = new PDFTextStripper().getText(document).strip();

            // 페이지당 글자 수가 임계치 미만이면 스캔본으로 본다 — 표지 한 장짜리 오판을 줄이려고
            // 총량이 아니라 페이지 평균으로 계산한다
            if (text.length() < (long) minCharsPerPage * pages) {
                return Result.sparse(text, pages);
            }
            return Result.extracted(text);
        } catch (IOException | RuntimeException e) {
            log.warn("PDF 텍스트 추출 실패: {}", pdf.getFileName(), e);
            return Result.failed("PDF를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.");
        }
    }

    public enum Outcome {
        /** 충분한 텍스트를 얻음 */
        EXTRACTED,
        /** 글자가 거의 없음 — 스캔본으로 보임, 2단계(LLM) 대상 */
        SPARSE,
        /** 열지 못함 (암호·손상 등) */
        FAILED
    }

    public record Result(Outcome outcome, String text, String reason) {

        static Result extracted(String text) {
            return new Result(Outcome.EXTRACTED, text, null);
        }

        static Result sparse(String text, int pages) {
            return new Result(Outcome.SPARSE, text,
                    "글자를 거의 찾지 못했습니다 (%d쪽). 스캔한 이미지 PDF로 보입니다.".formatted(pages));
        }

        static Result failed(String reason) {
            return new Result(Outcome.FAILED, null, reason);
        }
    }
}
