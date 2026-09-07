package com.mallang.auth.service;

import com.mallang.user.entity.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * 재설정 링크를 메일로 보낸다.
 *
 * <p>SMTP 가 설정돼 있지 않으면 <b>기동은 되고 발송만 건너뛴다.</b> 제공자를 아직 못
 * 정했더라도 나머지 코드를 먼저 배포할 수 있게 하려는 것이다.</p>
 *
 * <p>설정 여부는 <b>호스트 값이 비었는지</b>로 판단한다. 빈 존재 여부로 보면 안 된다 —
 * {@code spring.mail.host: ${SMTP_HOST:}} 처럼 기본값을 빈 문자열로 두면 Spring Boot 는
 * 프로퍼티가 <i>있다</i>고 보고 {@link JavaMailSender} 빈을 만들어 버린다. 그러면 호스트가
 * 빈 채로 발송을 시도해 요청마다 예외가 난다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PasswordResetMailSender {

    private final ObjectProvider<JavaMailSender> mailSenderProvider;

    @Value("${mallang.app.base-url}")
    private String baseUrl;

    @Value("${spring.mail.username:}")
    private String from;

    @Value("${spring.mail.host:}")
    private String mailHost;

    public void send(User teacher, String token, Duration validity) {
        String link = baseUrl + "/reset-password?token="
                + URLEncoder.encode(token, StandardCharsets.UTF_8);

        JavaMailSender sender = mailHost.isBlank() ? null : mailSenderProvider.getIfAvailable();
        if (sender == null) {
            log.warn("SMTP 가 설정되지 않아 재설정 메일을 보내지 못했습니다. userId={}", teacher.getId());
            // 링크는 계정 접근 권한 그 자체다. 로컬 개발 편의로 debug 에만 남기고,
            // 운영(info)에서는 절대 찍히지 않게 한다 — 로그는 Loki 로 수집되고 있다.
            log.debug("재설정 링크(로컬 확인용): {}", link);
            return;
        }

        SimpleMailMessage message = new SimpleMailMessage();
        if (!from.isBlank()) {
            message.setFrom(from);
        }
        message.setTo(teacher.getUsername()); // 선생님은 이메일이 곧 로그인 아이디다
        message.setSubject("[말랑] 비밀번호 재설정");
        message.setText("""
                %s 선생님, 안녕하세요.

                비밀번호를 다시 정하시려면 아래 주소를 열어 주세요.

                %s

                이 링크는 %d분 동안만 쓸 수 있고, 한 번 사용하면 만료됩니다.
                본인이 요청한 것이 아니라면 이 메일은 무시하셔도 됩니다.
                지금 쓰시는 비밀번호는 그대로입니다.
                """.formatted(teacher.getName(), link, validity.toMinutes()));

        try {
            sender.send(message);
            // 성공 경로가 무음이면 운영에서 "보내졌는지" 를 확인할 방법이 없다. 실패만
            // 남기면 로그가 비어 있는 것이 성공인지 호출 자체가 없었는지 구분되지 않는다.
            // 링크는 절대 남기지 않는다 — 그 자체가 계정 접근 권한이다. 주소는 가려서 남긴다.
            log.info("재설정 메일 발송 완료. userId={} to={}",
                    teacher.getId(), maskEmail(teacher.getUsername()));
        } catch (RuntimeException e) {
            // 메일 실패를 응답에 그대로 드러내면 "가입된 메일인지" 를 알려주는 꼴이 된다.
            // 호출자는 성공/실패와 무관하게 같은 응답을 주고, 원인은 여기 남긴다.
            log.warn("재설정 메일 발송 실패. userId={} to={}",
                    teacher.getId(), maskEmail(teacher.getUsername()), e);
        }
    }

    /**
     * 로그에 남길 주소를 가린다 — {@code hong@school.kr} → {@code hon***@school.kr}.
     *
     * <p>운영에서 "메일이 안 왔다" 는 문의를 받으면 어느 주소로 나갔는지 확인해야 하는데,
     * 주소를 통째로 남기면 로그 열람 권한이 곧 수신자 명단이 된다. 앞 세 글자와 도메인만
     * 남기면 본인 확인에는 충분하면서 명단으로는 쓸 수 없다. 도메인을 남기는 이유는
     * 오타(gmail/gmial)나 학교 메일 서버 문제를 이것만으로 짚어낼 수 있어서다.</p>
     */
    private static String maskEmail(String email) {
        if (email == null || email.isBlank()) {
            return "(없음)";
        }
        int at = email.indexOf('@');
        // @ 가 없거나 맨 앞이면 주소로 볼 수 없다 — 통째로 가린다.
        if (at <= 0) {
            return "***";
        }
        String local = email.substring(0, at);
        String head = local.length() <= 3 ? local : local.substring(0, 3);
        return head + "***" + email.substring(at);
    }
}
