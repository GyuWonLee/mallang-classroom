package com.mallang.global.json;

import org.springframework.boot.jackson.JacksonComponent;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;

/**
 * 오프셋이 붙은 값과 붙지 않은 값을 모두 받아 UTC 기준 LocalDateTime 으로 만든다.
 *
 * <p>{@link UtcLocalDateTimeSerializer} 가 "Z" 를 붙여 내보내므로, 클라이언트가 받은
 * 값을 그대로 되돌려 보내는 흐름(예: 과제 마감 수정)이 성립하려면 들어오는 쪽도
 * 오프셋을 이해해야 한다. 기본 역직렬화기는 "Z" 가 붙은 문자열을 거부한다.
 *
 * <p>오프셋이 없는 값은 구 클라이언트로 보고 UTC 로 간주한다 — 서버가 그렇게
 * 저장해 왔으므로 기존 동작과 같다.
 */
@JacksonComponent
public class UtcLocalDateTimeDeserializer extends ValueDeserializer<LocalDateTime> {

    @Override
    public LocalDateTime deserialize(JsonParser parser, DeserializationContext ctxt) {
        String raw = parser.getString();
        try {
            return OffsetDateTime.parse(raw)
                    .withOffsetSameInstant(ZoneOffset.UTC)
                    .toLocalDateTime();
        } catch (DateTimeParseException noOffset) {
            return LocalDateTime.parse(raw);
        }
    }
}
