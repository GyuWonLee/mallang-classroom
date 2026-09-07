package com.mallang.global.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 조용한 실패를 시끄럽게 만든다 — 커밋된 개발용 시크릿으로는 기동이 안 되어야 한다.
 */
class JwtSecretGuardTest {

    @Test
    @DisplayName("커밋된 개발용 기본값이면 기동을 막는다")
    void refusesToBootWithTheCommittedDevSecret() {
        assertThatThrownBy(() -> new JwtSecretGuard(JwtSecretGuard.COMMITTED_DEV_SECRET))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("위조");
    }

    @Test
    @DisplayName("비어 있어도 막는다 — JWT_SECRET= 로 덮어써도 통과하면 안 된다")
    void refusesToBootWithABlankSecret() {
        assertThatThrownBy(() -> new JwtSecretGuard("   "))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("주입된 값이면 통과한다")
    void acceptsAnInjectedSecret() {
        assertThatCode(() -> new JwtSecretGuard("k9Qx-real-secret-injected-from-env-32bytes!!"))
                .doesNotThrowAnyException();
    }

    /**
     * 가드는 <b>문자열 비교</b>다. application.yml 의 기본값이 바뀌면 조용히 무력화되므로,
     * 둘이 같은지를 여기서 붙들어 둔다. 이 테스트가 깨졌다면 둘 다 고쳐야 한다.
     */
    @Test
    @DisplayName("가드가 막는 문자열은 application.yml 의 기본값과 같아야 한다")
    void guardTracksTheValueActuallyCommittedInApplicationYml() throws Exception {
        String yml = Files.readString(Path.of("src/main/resources/application.yml"));

        assertThat(yml)
                .describedAs("application.yml 의 jwt.secret 기본값이 바뀌면 "
                        + "JwtSecretGuard.COMMITTED_DEV_SECRET 도 함께 고쳐야 가드가 살아 있다")
                .contains(JwtSecretGuard.COMMITTED_DEV_SECRET);
    }
}
