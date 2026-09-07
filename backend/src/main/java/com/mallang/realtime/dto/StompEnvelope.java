package com.mallang.realtime.dto;

import java.time.Instant;

/** 명세 섹션 10: 모든 STOMP 메시지의 공통 봉투 { type, payload, at } */
public record StompEnvelope(String type, Object payload, Instant at) {

    public static StompEnvelope of(String type, Object payload) {
        return new StompEnvelope(type, payload, Instant.now());
    }
}