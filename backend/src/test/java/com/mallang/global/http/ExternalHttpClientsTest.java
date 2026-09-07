package com.mallang.global.http;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.net.ServerSocket;
import java.net.Socket;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 외부 HTTP 호출 타임아웃.
 *
 * <p>타임아웃 설정은 "걸어 뒀다"는 착각이 제일 쉬운 종류다 — 값이 안 먹어도 정상일 때는
 * 아무 차이가 없고, 게이트웨이가 죽은 날에만 드러난다. 그래서 설정값을 리플렉션으로 들여다보는
 * 대신 <b>실제로 응답하지 않는 서버에 붙여</b> 끊기는지 본다.</p>
 */
class ExternalHttpClientsTest {

    @Test
    void readTimeoutActuallyFiresInsteadOfHangingForever() throws Exception {
        // 연결은 받아 주고 응답은 하지 않는 서버 — 게이트웨이가 멈춘 상황과 같다
        try (ServerSocket server = new ServerSocket(0)) {
            Thread silent = new Thread(() -> {
                try (Socket ignored = server.accept()) {
                    Thread.sleep(10_000);
                } catch (Exception ignored) {
                    // 테스트 종료로 소켓이 닫히는 것은 정상
                }
            });
            silent.setDaemon(true);
            silent.start();

            RestClient client = RestClient.builder()
                    .requestFactory(ExternalHttpClients.factory(Duration.ofMillis(300)))
                    .baseUrl("http://localhost:" + server.getLocalPort())
                    .build();

            long startedAt = System.nanoTime();
            assertThatThrownBy(() -> client.get().uri("/").retrieve().body(String.class))
                    .isInstanceOf(RuntimeException.class);
            Duration elapsed = Duration.ofNanos(System.nanoTime() - startedAt);

            // 핵심은 "예외가 났다"가 아니라 "무한히 기다리지 않았다"이다.
            // 타임아웃이 안 걸려 있으면 여기서 영영 돌아오지 않는다.
            assertThat(elapsed).isLessThan(Duration.ofSeconds(5));
        }
    }

    @Test
    void eachCallSiteCanChooseItsOwnReadTimeout() {
        // 한 문장 코멘트와 PDF OCR 은 걸리는 시간이 자릿수로 다르다 —
        // 팩터리가 호출부마다 다른 값을 받을 수 있어야 한 값으로 통일하는 실수를 안 한다.
        assertThat(ExternalHttpClients.factory(Duration.ofSeconds(15)))
                .isNotSameAs(ExternalHttpClients.factory(Duration.ofSeconds(60)));
    }
}
