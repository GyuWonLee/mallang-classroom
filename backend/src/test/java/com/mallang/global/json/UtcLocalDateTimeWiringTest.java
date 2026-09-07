package com.mallang.global.json;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import tools.jackson.databind.json.JsonMapper;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 직렬화기 자체가 아니라 <b>스프링이 실제로 등록했는지</b>를 확인한다.
 * {@code @JacksonComponent} 가 스캔되지 않으면 로직이 맞아도 응답은 그대로이므로,
 * 단위 테스트만으로는 이 수정이 동작한다고 말할 수 없다.
 */
@JsonTest
class UtcLocalDateTimeWiringTest {

    @Autowired
    private JsonMapper mapper;

    @Test
    @DisplayName("애플리케이션 매퍼가 LocalDateTime 에 Z 를 붙인다")
    void applicationMapperEmitsUtcOffset() {
        String json = mapper.writeValueAsString(LocalDateTime.of(2026, 8, 3, 1, 45, 22));

        assertThat(json).isEqualTo("\"2026-08-03T01:45:22Z\"");
    }
}
