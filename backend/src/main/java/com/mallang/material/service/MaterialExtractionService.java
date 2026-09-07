package com.mallang.material.service;

import com.mallang.file.service.FileStorage;
import com.mallang.material.entity.ExtractionSource;
import com.mallang.material.service.MaterialService.MaterialUploadedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

/**
 * 학습자료 추출 파이프라인 (명세 §6.5).
 *
 * AFTER_COMMIT 인 이유: 업로드 트랜잭션이 커밋되기 전에 다른 스레드가 조회하면 그 자료가 아직 없다.
 * @Async 로 응답 스레드를 붙잡지 않고 백그라운드에서 돈다 (업로드는 202 로 즉시 반환).
 *
 * 2단계 구조: 1단계(텍스트 레이어)로 먼저 읽고, 글자가 거의 없으면(스캔본) 2단계(멀티모달)로
 * 승격한다. LLM 을 항상 태우지 않는 이유는 비용 — 대부분의 자료는 1단계에서 끝난다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MaterialExtractionService {

    private final FileStorage fileStorage;
    private final PdfTextExtractor pdfTextExtractor;
    /** 2단계 — GMS 키가 없으면 빈이 없다(비어 있음). 그때는 1단계 결과로만 판정한다 */
    private final Optional<VisionTextExtractor> visionTextExtractor;
    /** DB 접촉은 전부 여기로 — 자기호출이면 @Transactional 이 무시된다 */
    private final MaterialExtractionStore store;

    /**
     * <p><b>트랜잭션을 열지 않는다.</b> 예전에는 이 메서드에 {@code REQUIRES_NEW} 가 붙어
     * 있어서, 추출이 끝날 때까지 DB 커넥션 하나를 붙잡았다. 1단계 PDF 파싱은 CPU 시간이고
     * 2단계는 페이지마다 LLM 을 부르므로(최대 {@code MATERIAL_VISION_MAX_PAGES} 장),
     * 스캔본 하나가 커넥션을 수 분 동안 점유할 수 있었다. 기본 풀이 10 이라 그동안 학급 전체가
     * 영향을 받는다.
     *
     * <p>대신 세 토막으로 나눈다: ① 짧은 읽기로 파일 경로만 가져오고 → ② 트랜잭션 밖에서
     * 추출하고 → ③ 결과만 짧은 트랜잭션으로 반영한다. 추출 중에는 커넥션을 쥐지 않는다.
     */
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onMaterialUploaded(MaterialUploadedEvent event) {
        String storageKey = store.readStorageKey(event.materialId());
        if (storageKey == null) {
            return;
        }

        Path pdf = fileStorage.resolve(storageKey);
        if (!Files.isReadable(pdf)) {
            store.applyFailure(event.materialId(), "업로드된 파일을 찾을 수 없습니다.");
            return;
        }

        // ② 여기서부터는 트랜잭션 밖 — 파싱과 LLM 호출이 아무리 길어져도 커넥션을 쥐지 않는다
        Outcome outcome = extract(pdf);
        if (outcome.failed()) {
            store.applyFailure(event.materialId(), outcome.reason());
        } else {
            store.applySuccess(event.materialId(), outcome.text(), outcome.source());
        }
    }

    /** 추출 결과 — 트랜잭션 밖에서 만들어 ③ 으로 넘긴다 */
    record Outcome(String text, ExtractionSource source, String reason) {
        static Outcome ok(String text, ExtractionSource source) {
            return new Outcome(text, source, null);
        }

        static Outcome fail(String reason) {
            return new Outcome(null, null, reason);
        }

        boolean failed() {
            return reason != null;
        }
    }

    private Outcome extract(Path pdf) {
        PdfTextExtractor.Result result = pdfTextExtractor.extract(pdf);
        return switch (result.outcome()) {
            case EXTRACTED -> Outcome.ok(result.text(), ExtractionSource.TEXT_LAYER);
            // 글자가 거의 없으면 스캔본 — 이미지로 읽어본다 (2단계)
            case SPARSE -> promoteToVision(pdf, result);
            // 파일 자체를 못 연 경우(암호·손상)는 이미지로도 못 읽으므로 승격하지 않는다
            case FAILED -> Outcome.fail(result.reason());
        };
    }

    private Outcome promoteToVision(Path pdf, PdfTextExtractor.Result stage1) {
        if (visionTextExtractor.isEmpty()) {
            return Outcome.fail(stage1.reason() + " 텍스트가 살아있는 PDF로 다시 올려주세요.");
        }
        VisionTextExtractor.Result vision = visionTextExtractor.get().extract(pdf);
        if (!vision.success()) {
            return Outcome.fail(vision.notice());
        }
        if (vision.notice() != null) {
            // 잘림·일부 실패는 실패가 아니라 미리보기에서 알릴 사항이다
            log.info("멀티모달 추출 주의 notice={}", vision.notice());
        }
        return Outcome.ok(vision.text(), ExtractionSource.LLM);
    }
}
