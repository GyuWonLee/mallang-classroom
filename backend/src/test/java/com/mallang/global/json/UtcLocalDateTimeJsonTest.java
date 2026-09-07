package com.mallang.global.json;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 화면에 9시간 어긋난 시각이 표시되던 문제의 회귀 테스트.
 * 저장은 UTC 로 하되 JSON 에는 그 사실(Z)을 실어 보내야 한다.
 */
class UtcLocalDateTimeJsonTest {

    private final JsonMapper mapper = JsonMapper.builder()
            .addModule(new SimpleModule()
                    .addSerializer(LocalDateTime.class, new UtcLocalDateTimeSerializer())
                    .addDeserializer(LocalDateTime.class, new UtcLocalDateTimeDeserializer()))
            .build();

    @Test
    @DisplayName("직렬화하면 UTC 임을 나타내는 Z 가 붙는다")
    void serializesWithUtcOffset() {
        String json = mapper.writeValueAsString(LocalDateTime.of(2026, 8, 3, 1, 45, 22));

        // Z 가 없으면 브라우저가 로컬 시간으로 읽어 9시간 어긋난다
        assertThat(json).isEqualTo("\"2026-08-03T01:45:22Z\"");
    }

    @Test
    @DisplayName("Z 가 붙은 값을 되돌려 받아도 같은 시각으로 복원된다")
    void roundTripsThroughZuluString() {
        LocalDateTime original = LocalDateTime.of(2026, 8, 3, 1, 45, 22);

        LocalDateTime restored = mapper.readValue(
                mapper.writeValueAsString(original), LocalDateTime.class);

        assertThat(restored).isEqualTo(original);
    }

    @Test
    @DisplayName("KST 오프셋으로 들어오면 UTC 로 환산해 저장한다")
    void convertsIncomingOffsetToUtc() {
        LocalDateTime parsed = mapper.readValue("\"2026-08-03T10:45:22+09:00\"", LocalDateTime.class);

        assertThat(parsed).isEqualTo(LocalDateTime.of(2026, 8, 3, 1, 45, 22));
    }

    @Test
    @DisplayName("오프셋 없는 구 클라이언트 값은 UTC 로 간주한다")
    void treatsOffsetlessInputAsUtc() {
        LocalDateTime parsed = mapper.readValue("\"2026-08-03T01:45:22\"", LocalDateTime.class);

        assertThat(parsed).isEqualTo(LocalDateTime.of(2026, 8, 3, 1, 45, 22));
    }
}
