package com.mallang.global.json;

import org.springframework.boot.jackson.JacksonComponent;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueSerializer;

import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * LocalDateTime 을 UTC 오프셋(Z)이 붙은 ISO-8601 로 내보낸다.
 *
 * <p>서버(호스트·JVM·Postgres)는 모두 UTC 이고 시각 컬럼은 전부
 * {@code timestamp without time zone} 이라, 저장된 값 자체는 UTC 로 일관된다.
 * 문제는 Jackson 기본 설정이 LocalDateTime 을 오프셋 없이 내보낸다는 점이었다
 * ({@code "2026-08-03T01:45:22"}). 자바스크립트의 {@code new Date()} 는 오프셋이
 * 없는 날짜-시간 문자열을 <b>로컬 시간</b>으로 해석하므로, 한국에서 보면 9시간
 * 이른 시각이 표시됐다 (오전 10:45 생성 → 화면에 오전 1:45).
 *
 * <p>값에 UTC 임을 명시해 내보내면 {@code new Date()} 가 정확히 해석하고
 * {@code toLocaleTimeString('ko-KR')} 이 한국 시각으로 표시한다. 프론트는 고칠 게 없다.
 *
 * <p>서버 타임존을 KST 로 바꾸는 방식은 택하지 않았다. 컬럼에 오프셋 정보가 없어
 * 기존 UTC 행과 새 KST 행을 구분할 수 없게 되기 때문이다.
 */
@JacksonComponent
public class UtcLocalDateTimeSerializer extends ValueSerializer<LocalDateTime> {

    @Override
    public void serialize(LocalDateTime value, JsonGenerator gen, SerializationContext ctxt) {
        // OffsetDateTime.toString() 은 UTC 오프셋을 "Z" 로 표기한다
        gen.writeString(value.atOffset(ZoneOffset.UTC).toString());
    }
}
