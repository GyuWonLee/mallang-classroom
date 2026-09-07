package com.mallang.material.service;

import com.mallang.global.http.ExternalHttpClients;
import com.mallang.assignment.ai.AiProperties;
import lombok.extern.slf4j.Slf4j;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.imageio.ImageIO;
import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import java.time.Duration;

/**
 * 추출 2단계 — 멀티모달 LLM 으로 스캔본 PDF 를 전사한다 (명세 §6.5).
 *
 * 1단계(PdfTextExtractor)에서 글자를 거의 못 찾은 자료만 여기로 온다. 항상 태우지 않는 이유는
 * 비용인데, 실측으로 작은 이미지 한 장에도 prompt 8.5k 토큰이 나갔다. 그래서
 *  - 페이지를 축소해 보내고 (maxImageWidth)
 *  - 페이지 수를 제한하며 (maxPages)
 *  - 페이지마다 따로 부른다 (한 요청에 몰면 컨텍스트 한계에 걸리고, 한 장 실패가 전체를 날린다)
 *
 * 게이트웨이는 assignment 도메인과 같은 ai.openai.* 설정을 쓴다 — 키를 한 곳에서만 관리하려고.
 * 키가 없으면 이 빈 자체가 만들어지지 않아 2단계는 조용히 건너뛰어진다.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "ai.openai.api-key")
public class VisionTextExtractor {

    private static final String PROMPT = """
            이 이미지는 초등학교 수업 자료의 한 페이지입니다.
            보이는 글자를 읽은 순서대로 그대로 옮겨 적어주세요.
            - 설명이나 요약을 덧붙이지 말고 본문만 적습니다.
            - 표는 줄 단위로 풀어서 적습니다.
            - 글자가 없으면 빈 문자열만 반환합니다.
            """;

    private final RestClient rest;
    private final AiProperties aiProperties;
    private final VisionExtractionProperties visionProperties;
    private final ObjectMapper objectMapper;

    public VisionTextExtractor(AiProperties aiProperties,
                               VisionExtractionProperties visionProperties,
                               ObjectMapper objectMapper) {
        this.aiProperties = aiProperties;
        this.visionProperties = visionProperties;
        this.objectMapper = objectMapper;
        // 페이지 이미지를 실어 보내는 OCR — 넷 중 가장 무겁다.
        this.rest = RestClient.builder()
                .requestFactory(ExternalHttpClients.factory(Duration.ofSeconds(60)))
                .baseUrl(aiProperties.openai().baseUrl())
                .defaultHeader("Authorization", "Bearer " + aiProperties.openai().apiKey())
                .build();
    }

    public Result extract(Path pdf) {
        try (PDDocument document = Loader.loadPDF(pdf.toFile())) {
            int total = document.getNumberOfPages();
            int limit = Math.min(total, visionProperties.maxPages());
            PDFRenderer renderer = new PDFRenderer(document);

            StringBuilder text = new StringBuilder();
            int failedPages = 0;
            for (int page = 0; page < limit; page++) {
                String pageText = transcribe(renderer, page);
                if (pageText == null) {
                    failedPages++;
                    continue;
                }
                if (!pageText.isBlank()) {
                    text.append(pageText.strip()).append("\n\n");
                }
            }

            if (text.isEmpty()) {
                return Result.failed("이미지에서도 글자를 찾지 못했습니다.");
            }
            return new Result(text.toString().strip(), truncationNotice(total, limit, failedPages));
        } catch (Exception e) {
            log.warn("멀티모달 추출 실패: {}", pdf.getFileName(), e);
            return Result.failed("이미지 판독 중 문제가 발생했습니다.");
        }
    }

    /** 한 장 실패는 전체를 실패시키지 않는다 — 나머지 페이지 본문이라도 살린다 */
    private String transcribe(PDFRenderer renderer, int pageIndex) {
        try {
            BufferedImage rendered = renderer.renderImageWithDPI(
                    pageIndex, visionProperties.renderDpi(), ImageType.RGB);
            String base64 = toBase64Png(shrink(rendered));
            Map<String, Object> body = Map.of(
                    "model", visionProperties.model(),
                    "max_completion_tokens", visionProperties.maxOutputTokens(),
                    "messages", List.of(Map.of("role", "user", "content", List.of(
                            Map.of("type", "text", "text", PROMPT),
                            Map.of("type", "image_url", "image_url",
                                    Map.of("url", "data:image/png;base64," + base64))))));

            String raw = rest.post()
                    .uri(aiProperties.openai().chatPath())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);
            return contentOf(raw);
        } catch (Exception e) {
            log.warn("페이지 전사 실패 page={}", pageIndex + 1, e);
            return null;
        }
    }

    /** 긴 변이 한도를 넘으면 비율을 유지한 채 줄인다 — 토큰이 곧 픽셀이라 */
    BufferedImage shrink(BufferedImage source) {
        int longest = Math.max(source.getWidth(), source.getHeight());
        int limit = visionProperties.maxImageWidth();
        if (longest <= limit) {
            return source;
        }
        double ratio = (double) limit / longest;
        int width = Math.max(1, (int) Math.round(source.getWidth() * ratio));
        int height = Math.max(1, (int) Math.round(source.getHeight() * ratio));
        BufferedImage resized = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        resized.getGraphics().drawImage(
                source.getScaledInstance(width, height, Image.SCALE_SMOOTH), 0, 0, null);
        return resized;
    }

    private String toBase64Png(BufferedImage image) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return Base64.getEncoder().encodeToString(out.toByteArray());
    }

    private String contentOf(String raw) {
        try {
            JsonNode content = objectMapper.readTree(raw)
                    .path("choices").path(0).path("message").path("content");
            return content.isMissingNode() || content.isNull() ? null : content.asString();
        } catch (JacksonException e) {
            log.warn("게이트웨이 응답 해석 실패: {}", raw, e);
            return null;
        }
    }

    private String truncationNotice(int total, int limit, int failedPages) {
        StringBuilder notice = new StringBuilder();
        if (limit < total) {
            notice.append("분량이 많아 앞 %d쪽만 읽었습니다 (전체 %d쪽). ".formatted(limit, total));
        }
        if (failedPages > 0) {
            notice.append("%d쪽은 읽지 못했습니다. ".formatted(failedPages));
        }
        return notice.isEmpty() ? null : notice.toString().strip();
    }

    /** text 가 null 이면 실패, notice 는 있으면 미리보기에서 선생님에게 알릴 내용 */
    public record Result(String text, String notice) {

        static Result failed(String reason) {
            return new Result(null, reason);
        }

        public boolean success() {
            return text != null;
        }
    }
}
