package com.mallang.report.service;

import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/**
 * 생활통지표를 이메일로 보낸다 (S15P11A407-145).
 *
 * <p>SMTP 설정 여부는 <b>호스트 값이 비었는지</b>로 판단한다({@code spring.mail.host: ${SMTP_HOST:}} 는
 * 기본값이 빈 문자열이라 프로퍼티가 <i>있다</i>고 잡혀 빈이 만들어지기 때문).</p>
 *
 * <p><b>발송은 비동기다.</b> PDF(수백 KB) 첨부 전송은 Gmail 확인응답까지 수십 초가 걸릴 수 있는데,
 * 요청 스레드에서 동기로 기다리면 <b>앞단 프록시가 ~25초에서 응답을 끊어</b> — 메일은 배달됐는데도
 * 화면엔 "전송 실패"가 뜬다. 그래서 요청은 접수 즉시 반환하고(설정 여부만 동기로 확인), 실제 전송은
 * 학생 계정 안내 메일과 같은 {@code studentMailExecutor} 에서 백그라운드로 처리한다. 발송 실패는
 * 예외로 올리지 않고 로그로만 남긴다(요청은 이미 끝났다).</p>
 *
 * <p>PDF(전체 이미지)는 프론트가 만들어 넘긴다. 있으면 첨부(MIME), 없으면 본문 텍스트만 보낸다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ReportCardMailSender {

    private final ObjectProvider<JavaMailSender> mailSenderProvider;

    @Value("${spring.mail.username:}")
    private String from;

    @Value("${spring.mail.host:}")
    private String mailHost;

    /** SMTP 가 설정돼 실제로 보낼 수 있는지 — 호출부가 접수 전에 동기로 확인해 미설정이면 바로 알린다. */
    public boolean isConfigured() {
        return !mailHost.isBlank() && mailSenderProvider.getIfAvailable() != null;
    }

    /**
     * 실제 전송(백그라운드). 실패해도 예외를 올리지 않고 로그만 남긴다 — 요청은 이미 접수 응답을 냈다.
     *
     * @param pdf      전체 이미지 PDF 바이트(프론트 생성). null 이면 본문 텍스트만 보낸다.
     * @param filename 첨부 파일명(pdf 가 있을 때만 사용)
     */
    @Async("studentMailExecutor")
    public void sendAsync(String to, String subject, String bodyText, byte[] pdf, String filename) {
        JavaMailSender sender = mailHost.isBlank() ? null : mailSenderProvider.getIfAvailable();
        if (sender == null) {
            log.warn("SMTP 가 설정되지 않아 통지표 메일을 보내지 못했습니다.");
            return;
        }
        try {
            if (pdf != null && pdf.length > 0) {
                MimeMessage mime = sender.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(mime, true, "UTF-8");
                if (!from.isBlank()) {
                    helper.setFrom(from);
                }
                helper.setTo(to);
                helper.setSubject(subject);
                helper.setText(bodyText, false);
                helper.addAttachment(filename, new ByteArrayResource(pdf), "application/pdf");
                sender.send(mime);
            } else {
                SimpleMailMessage message = new SimpleMailMessage();
                if (!from.isBlank()) {
                    message.setFrom(from);
                }
                message.setTo(to);
                message.setSubject(subject);
                message.setText(bodyText);
                sender.send(message);
            }
        } catch (Exception e) {
            // 수신 주소는 로그에 남기지 않는다(개인정보). 원인만 남긴다.
            log.warn("통지표 메일 발송 실패(비동기)", e);
        }
    }
}
