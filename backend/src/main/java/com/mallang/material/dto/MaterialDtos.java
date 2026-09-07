package com.mallang.material.dto;

import com.mallang.material.entity.Material;

import java.time.LocalDateTime;

/** 학습자료 DTO — 명세 §6.5 */
public class MaterialDtos {

    /** 업로드 직후 응답 (202) — 추출은 비동기라 상태는 PROCESSING */
    public record MaterialUploadResponse(Long materialId, String status) {

        public static MaterialUploadResponse from(Material material) {
            return new MaterialUploadResponse(material.getId(), material.getStatus().name());
        }
    }

    /** 목록 항목 — 추출 텍스트는 싣지 않는다 (목록에서 전문을 내리면 응답이 커진다) */
    public record MaterialSummaryResponse(
            Long materialId,
            String title,
            String status,
            String extractionSource,
            String failureReason,
            /**
             * 원본 PDF 의 파일 id — 화면이 {@code GET /api/files/{fileId}/content} 로 받아 그대로 보여준다.
             *
             * <p>추출 텍스트만 보여 주던 확인 화면이 선생님에게 낯설었다. 올린 것은 PDF 인데
             * 화면에는 뜯어낸 글자만 있으니 "이게 내 자료가 맞나"를 판단할 근거가 약했다.</p>
             */
            String fileId,
            /** 몇 학년 자료인가 — null 이면 공용(어느 학년에서도 고를 수 있다) */
            Short grade,
            /** 어느 과목인가 — null 이면 공용 */
            String subject,
            LocalDateTime createdAt
    ) {
        public static MaterialSummaryResponse from(Material material) {
            return new MaterialSummaryResponse(
                    material.getId(), material.getTitle(), material.getStatus().name(),
                    material.getExtractionSource() == null ? null : material.getExtractionSource().name(),
                    material.getFailureReason(), fileIdOf(material),
                    material.getGrade(), subjectOf(material), material.getCreatedAt());
        }
    }

    private static String subjectOf(Material material) {
        return material.getSubject() == null ? null : material.getSubject().name();
    }

    /**
     * 파일이 없는 자료는 없지만, 그래도 목록 전체를 500 으로 만들지는 않는다.
     * 화면은 이 값이 null 이면 "원본을 찾을 수 없다"고 말하고 추출 텍스트로 넘어간다.
     */
    private static String fileIdOf(Material material) {
        if (material.getFile() == null || material.getFile().getId() == null) {
            return null;
        }
        return material.getFile().getId().toString();
    }

    /**
     * 상세 — 업로드 후 폴링용. preview 는 앞부분만, extractedLength 로 전체 분량을 알린다.
     */
    public record MaterialDetailResponse(
            Long materialId,
            String title,
            String status,
            String extractionSource,
            String failureReason,
            String preview,
            int extractedLength,
            /** 원본 PDF 파일 id — 확인 화면이 이걸로 PDF 를 그대로 띄운다 */
            String fileId,
            Short grade,
            String subject,
            LocalDateTime createdAt
    ) {
        public static MaterialDetailResponse from(Material material) {
            return new MaterialDetailResponse(
                    material.getId(), material.getTitle(), material.getStatus().name(),
                    material.getExtractionSource() == null ? null : material.getExtractionSource().name(),
                    material.getFailureReason(), material.preview(), material.extractedLength(),
                    fileIdOf(material), material.getGrade(), subjectOf(material),
                    material.getCreatedAt());
        }
    }
}
