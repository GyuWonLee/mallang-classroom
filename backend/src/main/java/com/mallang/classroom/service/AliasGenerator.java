package com.mallang.classroom.service;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.List;

/**
 * 학급 별칭(alias) 자동 배정 — 학생 아이디 생성 재료 (예: dodam → dodam01).
 *
 * <p>alias 는 유일하지 않다. 학급 둘이 같은 단어를 가져도 되며, 실제로 지켜야 하는
 * username 의 유일성은 {@link StudentAccountIssuer} 가 발급 시점에 보장한다
 * (같은 alias 라면 한쪽이 dodam01~05, 다른 쪽이 dodam06~10 을 받는다).
 * 덕분에 단어 풀의 크기가 만들 수 있는 학급 수의 상한이 되지 않는다.
 *
 * <p>풀의 단어끼리 접두어 관계가 없는 편이 좋다 — username 번호의 시작값을 접두어
 * 매칭으로 추정하므로 접두어가 겹치면 번호가 건너뛴다 (충돌은 나지 않는다).
 */
@Component
public class AliasGenerator {

    // 초등 저학년에게 친숙한 순우리말 위주 (모두 소문자, 상호 접두어 없음)
    private static final List<String> WORD_POOL = List.of(
            "dodam", "saebom", "haneul", "gureum", "byeoli", "dalgom", "songi",
            "borami", "aram", "chorong", "saessak", "kkoma", "tokki", "darami",
            "nabi", "podo", "sagwa", "yeolmae", "hodu", "bamtol", "solbi",
            "garam", "mireu", "nuri", "bitna", "hanul", "seodam", "yeoul",
            "danbi", "meari", "sori", "gippeum", "woongi", "poby", "coco");

    private final SecureRandom random = new SecureRandom();

    public String generate() {
        return WORD_POOL.get(random.nextInt(WORD_POOL.size()));
    }
}
