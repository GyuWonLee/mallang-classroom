package com.mallang.report.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/** 생활통지표 (S15P11A407-145). */
public class ReportCardDtos {

    /**
     * 통지표 한 줄 — 과목·영역별 평가. subject 는 enum 이름(KOREAN…, 한글 표기는 프론트가 매핑).
     * evalElement 는 평가요소 문장(LLM 초안 또는 선생님 작성), rating 은 평가 등급(매우잘함/잘함/보통/노력요함).
     */
    public record Entry(
            String subject,
            String area,
            String evalElement,
            String rating
    ) {
    }

    /** 통지표 조회/초안 응답. */
    public record ReportCardResponse(Long studentId, List<Entry> entries) {
        public static ReportCardResponse of(Long studentId, List<Entry> entries) {
            return new ReportCardResponse(studentId, entries);
        }
    }

    /** 통지표 저장 요청 — 선생님이 수정한 평가요소·평가를 통째로 보낸다. */
    public record SaveReportCardRequest(@NotNull List<Entry> entries) {
    }

    /**
     * 학년 통지표 한 줄 — "학년 통지표 한 번에 보기" 배치 조회의 학생별 요약.
     * saved 가 false 면 아직 통지표를 만들지 않은 학생(entries 는 빈 목록).
     */
    public record ReportCardSummary(
            Long studentId,
            String studentName,
            Short grade,
            boolean saved,
            List<Entry> entries
    ) {
    }

    /**
     * 통지표 이메일 발송 요청.
     *
     * <p>학생·학부모 이메일은 시스템에 저장돼 있지 않아 <b>수신 주소를 선생님이 넣어 보낸다.</b>
     * PDF(전체 이미지)는 프론트가 만들어 base64 로 실어 보내면 그대로 첨부한다. 없으면
     * 저장된 통지표 내용을 본문 텍스트로 보낸다.</p>
     */
    public record EmailReportCardRequest(
            @NotBlank @Email String recipientEmail,
            String pdfBase64,
            String filename,
            String message
    ) {
    }

    /** 이메일 발송 결과 — sent=true 는 <b>발송을 접수했다</b>는 뜻(실제 전송은 백그라운드 비동기). */
    public record EmailReportCardResponse(boolean sent, String recipientEmail) {
    }
}
