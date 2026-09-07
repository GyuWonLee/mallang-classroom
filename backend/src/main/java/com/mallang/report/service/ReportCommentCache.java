package com.mallang.report.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * 리포트 코멘트 캐시.
 *
 * <p>학습현황 첫 로딩이 느린 원인은 SQL이 아니라 GMS 왕복이었다 — 운영에서 1.07~1.88초로
 * 측정됐고(2026-08-03), 같은 시점 운영 DB의 제출은 8건이라 집계 시간은 사실상 0이었다.</p>
 *
 * <p><b>키에 강·약점의 지문을 넣는 것이 곧 무효화다.</b> 코멘트는 그 두 목록에만 의존하므로,
 * 새 채점으로 목록이 바뀌면 키가 저절로 갈린다 — 옛 코멘트를 찾아 지울 일이 없다.</p>
 *
 * <p>반대로 목록이 같으면 학생이 달라도 같은 문장이 나온다. 코멘트에는 이름도 숫자도 넣지
 * 않기로 돼 있어(명세 §8) 공유해도 어긋나지 않고, 템플릿 폴백도 원래 같은 입력이면 같은
 * 문장을 낸다. 오히려 학급 전체의 캐시 적중률이 올라간다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ReportCommentCache {

    /** 프롬프트를 손보면 이 값을 올린다 — 안 그러면 옛 문장이 TTL 만큼 남는다. */
    private static final String KEY_PREFIX = "report:comment:v1:";

    /** 키가 내용을 담고 있어 만료는 무효화가 아니라 청소 목적이다. */
    private static final Duration TTL = Duration.ofDays(7);

    private final StringRedisTemplate redis;

    /** 강·약점 조합으로 캐시된 코멘트를 주거나, 없으면 generator 를 돌려 채운다. */
    public String get(List<String> strengths, List<String> weaknesses, Supplier<String> generator) {
        return cached(KEY_PREFIX + signature(strengths, weaknesses), generator);
    }

    /** 채점 데이터가 없을 때의 안내 — 입력이 없으니 키도 하나다. */
    public String getNoData(Supplier<String> generator) {
        return cached(KEY_PREFIX + "nodata", generator);
    }

    private String cached(String key, Supplier<String> generator) {
        try {
            String hit = redis.opsForValue().get(key);
            if (hit != null) {
                return hit;
            }
        } catch (RuntimeException e) {
            // Redis 가 죽었다고 리포트를 막지 않는다 — 캐시 이전 속도로 돌아갈 뿐이다
            log.warn("리포트 코멘트 캐시 조회 실패 — 캐시 없이 진행", e);
            return generator.get();
        }

        String generated = generator.get();
        if (generated == null) {
            // 생성 실패는 캐시하지 않는다. 일시적인 GMS 장애로 나온 폴백 문구가
            // 7일 동안 굳어버리면, 정작 GMS 가 살아나도 LLM 코멘트가 안 나온다.
            return null;
        }
        try {
            redis.opsForValue().set(key, generated, TTL);
        } catch (RuntimeException e) {
            log.warn("리포트 코멘트 캐시 저장 실패 — 이번 결과는 캐시하지 않는다", e);
        }
        return generated;
    }

    /**
     * 강·약점 목록의 지문. 정렬 후 해싱하는 이유는 목록 순서가 제출 순서를 타고 오기 때문이다 —
     * 같은 강·약점인데 순서만 달라 캐시가 빗나가면 안 된다.
     */
    private String signature(List<String> strengths, List<String> weaknesses) {
        List<String> sorted = new ArrayList<>(strengths);
        List<String> sortedWeak = new ArrayList<>(weaknesses);
        sorted.sort(null);
        sortedWeak.sort(null);
        return sha256(String.join(",", sorted) + "|" + String.join(",", sortedWeak));
    }

    private String sha256(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(32);
            for (int i = 0; i < 16; i++) { // 앞 16바이트면 충돌 걱정 없이 키가 짧다
                sb.append(String.format("%02x", digest[i]));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 을 쓸 수 없습니다.", e);
        }
    }
}
