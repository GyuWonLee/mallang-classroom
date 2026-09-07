package com.mallang.classroom.service;

import com.mallang.classroom.service.ClassroomService.IssuedAccount;
import com.mallang.classroom.service.ClassroomService.StudentAccountsIssuedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 학생 계정 안내 메일 — 학부모에게 아이디와 임시 비밀번호를 보낸다.
 *
 * <p>AFTER_COMMIT 인 이유: 계정 생성 트랜잭션이 커밋되기 전에 메일이 나가면, 롤백됐을 때
 * 존재하지 않는 계정의 안내가 학부모에게 가 있다. CSV 등록은 한 행이라도 잘못되면 전체를
 * 되돌리므로 실제로 일어날 수 있는 일이다. {@code @Async} 는 응답 스레드도 붙잡지 않는다.</p>
 *
 * <p>SMTP 미설정 시 조용히 건너뛰는 것은 {@link com.mallang.auth.service.PasswordResetMailSender}
 * 와 같은 판단이고, <b>판단 기준도 같다</b> — 빈 존재 여부가 아니라 호스트 값이 비었는지로 본다.
 * {@code spring.mail.host: ${SMTP_HOST:}} 는 값이 비어도 프로퍼티가 <i>있는</i> 것이라
 * {@link JavaMailSender} 빈이 만들어져 버리기 때문이다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StudentAccountMailSender {

    private final ObjectProvider<JavaMailSender> mailSenderProvider;

    @Value("${mallang.app.base-url}")
    private String baseUrl;

    @Value("${spring.mail.username:}")
    private String from;

    @Value("${spring.mail.host:}")
    private String mailHost;

    @Async("studentMailExecutor")
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStudentAccountsIssued(StudentAccountsIssuedEvent event) {
        int total = event.accounts().size();
        JavaMailSender sender = mailHost.isBlank() ? null : mailSenderProvider.getIfAvailable();
        if (sender == null) {
            log.warn("SMTP 가 설정되지 않아 학생 계정 안내 메일 {}건을 보내지 못했습니다.", total);
            return;
        }

        int sent = 0;
        for (IssuedAccount account : event.accounts()) {
            if (send(sender, event.classroomName(), account)) {
                sent++;
            }
        }
        // 못 받은 학생은 선생님이 종이 안내장으로 대신 줘야 하므로 건수를 남긴다
        log.info("학생 계정 안내 메일 발송 {}/{}건 (학급: {})", sent, total, event.classroomName());
    }

    private boolean send(JavaMailSender sender, String classroomName, IssuedAccount account) {
        SimpleMailMessage message = new SimpleMailMessage();
        if (!from.isBlank()) {
            message.setFrom(from);
        }
        message.setTo(account.parentEmail());
        message.setSubject("[말랑] %s 학생 계정 안내".formatted(account.studentName()));
        message.setText("""
                %s 학부모님께, 안녕하세요.

                %s 학급의 말랑 계정이 만들어졌습니다.
                아래 정보로 로그인할 수 있습니다.

                  아이디       : %s
                  임시 비밀번호 : %s

                  %s

                처음 로그인한 뒤에는 비밀번호를 바꿔 주세요.
                이 메일은 계정 정보를 담고 있으니 다른 분께 전달하지 마세요.
                """.formatted(account.studentName(), classroomName,
                account.username(), account.temporaryPassword(), baseUrl));

        try {
            sender.send(message);
            return true;
        } catch (RuntimeException e) {
            // 한 명이 실패해도 나머지는 계속 보낸다. 임시 비밀번호는 절대 로그에 넣지 않는다
            log.warn("학생 계정 안내 메일 발송 실패. username={}", account.username(), e);
            return false;
        }
    }
}
