package com.mallang.assignment.ai;

import com.mallang.global.http.ExternalHttpClients;
import org.springframework.web.client.RestClient;

import java.time.Duration;

/**
 * GMS(OpenAI 호환 게이트웨이) 채팅 클라이언트 생성.
 *
 * <p>"설정이 됐는가"를 판단하고 타임아웃 붙인 클라이언트를 만드는 일이 호출부마다 똑같이
 * 복사돼 있었다. 같은 코드가 두 벌이면 한쪽만 고치는 일이 생기는데, 하필 이 판단이 틀리면
 * 키가 없는 환경에서 NPE 가 나거나 반대로 폴백이 영원히 안 걸린다.</p>
 *
 * <p>{@code null} 을 돌려주는 것이 이 API 의 계약이다 — 호출부는 별도 플래그를 두지 않고
 * "클라이언트가 있는가"로 곧장 판단한다. 설정은 기동 시 한 번 바인딩되므로(AiProperties 는 record)
 * 생성자에서 한 번 부르면 그 값이 빈 수명 내내 유효하다.</p>
 */
public final class GmsChatClients {

    private GmsChatClients() {
    }

    /**
     * 부를 수 있으면 클라이언트, 설정이 없으면 null.
     *
     * <p>읽기 타임아웃을 호출부가 정하는 이유는 기다리는 사람이 다르기 때문이다 —
     * 총평은 학생이 답안 화면을 여는 동안, 말랑이는 질문을 보내고 답을 기다리는 동안이다.</p>
     */
    public static RestClient orNull(AiProperties properties, Duration readTimeout) {
        AiProperties.OpenAi openai = properties.openai();
        if (!"openai".equalsIgnoreCase(properties.provider())
                || openai == null
                || openai.apiKey() == null
                || openai.apiKey().isBlank()) {
            return null;
        }
        return RestClient.builder()
                .requestFactory(ExternalHttpClients.factory(readTimeout))
                .baseUrl(openai.baseUrl())
                .defaultHeader("Authorization", "Bearer " + openai.apiKey())
                .build();
    }
}
