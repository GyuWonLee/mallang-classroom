package com.mallang.material.service;

import com.mallang.material.entity.ExtractionSource;
import com.mallang.material.repository.MaterialRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 학습자료 추출의 <b>DB 접촉 부분만</b> 담는다 — 읽기 한 번, 쓰기 한 번.
 *
 * <p>왜 별도 빈인가: {@code @Transactional} 은 프록시를 거쳐야 동작한다. 같은 클래스 안의
 * 메서드를 부르면(자기호출) 프록시를 타지 않아 <b>애노테이션이 조용히 무시된다</b>.
 * {@link MaterialExtractionService} 가 추출 중에는 커넥션을 쥐지 않으려고 트랜잭션을
 * 잘게 나눴는데, 그 조각들을 같은 클래스에 두면 나눈 의미가 없어진다.
 *
 * <p>{@code REQUIRES_NEW} 인 이유: 호출자가 {@code AFTER_COMMIT} 리스너라 이미 커밋된
 * 트랜잭션의 바깥이다. 새로 열어야 결과가 저장된다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class MaterialExtractionStore {

    private final MaterialRepository materialRepository;

    /** 추출에 필요한 파일 경로만 읽고 즉시 닫는다 */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public String readStorageKey(Long materialId) {
        return materialRepository.findById(materialId)
                .map(m -> m.getFile().getStorageKey())
                .orElse(null);
    }

    /** 추출 결과만 반영한다 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void applySuccess(Long materialId, String text, ExtractionSource source) {
        materialRepository.findById(materialId).ifPresent(material -> {
            material.previewReady(text, source);
            log.info("학습자료 추출 완료 materialId={} status={} source={}",
                    material.getId(), material.getStatus(), material.getExtractionSource());
        });
    }

    /** 추출 실패를 반영한다 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void applyFailure(Long materialId, String reason) {
        materialRepository.findById(materialId).ifPresent(material -> {
            material.fail(reason);
            log.info("학습자료 추출 실패 materialId={} reason={}", material.getId(), reason);
        });
    }
}
