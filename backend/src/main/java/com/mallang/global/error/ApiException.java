package com.mallang.global.error;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 비즈니스 예외. type(슬러그)은 RFC 9457 응답의 type URI 끝부분이 된다.
 * 예: throw new ApiException(HttpStatus.CONFLICT, "duplicate-username", "이미 사용 중인 이메일입니다.")
 */
@Getter
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String type;

    public ApiException(HttpStatus status, String type, String message) {
        super(message);
        this.status = status;
        this.type = type;
    }
}
