package com.mallang.global.http;

import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;

import java.time.Duration;

/**
 * 외부 HTTP 호출(LLM 게이트웨이·TTS)의 타임아웃 기본값.
 *
 * <p>{@code RestClient.builder()} 는 타임아웃을 걸지 않으면 <b>무한 대기</b>다. 게이트웨이가
 * 응답하지 않으면 호출 스레드가 영영 돌아오지 않고, 그게 요청 스레드면 톰캣 풀이,
 * 비동기 작업 스레드면 그 풀이 그대로 마른다. 실제로 AI 호출부 네 곳이 전부 이 상태였다.</p>
 *
 * <p>각자 builder 에 직접 설정하지 않고 여기로 모은 이유는, 새 호출부가 생길 때 타임아웃을
 * 빠뜨리는 것이 기본값이 되지 않게 하려는 것이다 — 빠뜨려도 티가 안 나는 종류의 실수다.</p>
 */
public final class ExternalHttpClients {

    /**
     * 커넥션 타임아웃은 모든 호출이 같다. 게이트웨이에 TCP 로 붙는 데 3초가 넘게 걸린다면
     * 그건 느린 게 아니라 못 붙는 것이므로, 오래 기다려도 결과가 달라지지 않는다.
     */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);

    private ExternalHttpClients() {
    }

    /**
     * 읽기 타임아웃은 호출마다 다르게 준다 — 한 문장 코멘트와 PDF 여러 장 OCR 은
     * 걸리는 시간이 자릿수로 다르다. 값을 하나로 통일하면 짧은 쪽이 과하게 기다리거나
     * 긴 쪽이 정상 응답을 끊어 버린다.
     */
    public static ClientHttpRequestFactory factory(Duration readTimeout) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(CONNECT_TIMEOUT);
        factory.setReadTimeout(readTimeout);
        return factory;
    }
}
