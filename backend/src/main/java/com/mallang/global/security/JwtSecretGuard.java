package com.mallang.global.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 커밋된 개발용 JWT 시크릿으로는 뜨지 않게 막는다.
 *
 * <p>{@code application.yml} 의 {@code jwt.secret} 에는 기본값이 박혀 있다. 운영 {@code .env}
 * 에서 {@code JWT_SECRET} 이 빠지거나 오타가 나면 서비스는 <b>아무 이상 없이 뜨고</b>, 그
 * 순간 저장소를 열어 본 누구나 그 공개된 문자열로 {@code role=TEACHER} 토큰을 서명할 수
 * 있다. 아이들의 학급에 선생님으로 들어갈 수 있다는 뜻이다.
 *
 * <p>이 항목의 값어치는 뚫려 있다는 사실이 아니라 <b>실패가 조용하다</b>는 데 있다.
 * (실제로 운영에는 {@code JWT_SECRET} 이 주입되어 있다 — 지금 뚫려 있는 상태가 아니다.
 * 막으려는 것은 언젠가 그 한 줄이 빠지는 날이다.)
 *
 * <p>왜 {@code @Profile("prod")} 가 아닌가: 저장소 어디에도 {@code SPRING_PROFILES_ACTIVE}
 * 가 없고 {@code application.yml} 의 기본 프로필은 {@code local} 이다. 운영이 local 로 뜨고
 * 있으면 프로필 가드는 영원히 발동하지 않는다. <b>값 자체를 비교</b>하면 어느 프로필이든 걸린다.
 *
 * <p>32바이트 미만 검사는 넣지 않는다 — {@code Keys.hmacShaKeyFor} 가 이미
 * {@code WeakKeyException} 으로 막는다. 두 번 검사할 이유가 없다.
 *
 * <p>빈 생성이 실패하면 컨텍스트가 뜨지 않고, 블루-그린 배포는 새 슬롯 헬스체크에서 걸려
 * <b>전환 자체가 일어나지 않는다.</b> 잘못된 배포는 트래픽을 받기 전에 막힌다.
 */
@Component
public class JwtSecretGuard {

    /** {@code application.yml} 에 커밋된 개발용 기본값. 이 값이면 운영이 아니다. */
    static final String COMMITTED_DEV_SECRET = "mallang-local-dev-secret-key-change-me-32bytes!";

    public JwtSecretGuard(@Value("${jwt.secret}") String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "JWT_SECRET 이 비어 있습니다. 이 값 없이는 로그인 토큰을 안전하게 서명할 수 없습니다. "
                            + "infra/server/.env 에 JWT_SECRET 을 32바이트 이상으로 설정하세요.");
        }
        if (COMMITTED_DEV_SECRET.equals(secret)) {
            throw new IllegalStateException(
                    "JWT_SECRET 이 저장소에 커밋된 개발용 기본값 그대로입니다. "
                            + "이 문자열은 공개되어 있어 누구나 교사 토큰을 위조할 수 있습니다. "
                            + "환경변수 JWT_SECRET 을 별도의 값으로 설정하세요 "
                            + "(예: openssl rand -base64 48).");
        }
    }
}
