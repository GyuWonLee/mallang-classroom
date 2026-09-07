package com.mallang.file.service;

import com.mallang.file.dto.FileDtos.UploadResponse;
import com.mallang.file.entity.FilePurpose;
import com.mallang.file.entity.UploadedFile;
import com.mallang.file.repository.UploadedFileRepository;
import com.mallang.file.tts.TtsProperties;
import com.mallang.file.tts.TtsProvider;
import com.mallang.file.tts.TtsProvider.SynthesizedAudio;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * 텍스트→음성 온디맨드 생성 (명세 §9의 POST /tts). 학생이 문제별 버튼으로 호출하면
 * 음성을 생성해 {@link FilePurpose#TTS_AUDIO} 파일로 저장하고, 재생은 기존 GET /api/files/{id}/content 를 쓴다.
 *
 * <p>바이트 저장은 팀 파일 도메인({@link FileStorage}·{@link UploadedFile})을 재사용한다.
 * 생성자는 요청 학생 본인 → 소유자로 저장되어 {@link FileService#download} 권한(소유자)에 그대로 맞는다.
 * (여러 학생이 같은 문항을 눌러도 각자 자기 소유로 생성 — 학급 전원 공유 최적화는 "공개 과제 참조" 규칙과 함께 후속.)
 */
@Service
@RequiredArgsConstructor
public class TtsService {

    private final TtsProvider ttsProvider;
    private final FileStorage storage;
    private final UploadedFileRepository uploadedFileRepository;
    private final UserRepository userRepository;
    private final TtsProperties properties;

    /**
     * <p><b>{@code @Transactional} 을 붙이지 않는다.</b> 여기서 부르는 TTS 게이트웨이는 읽기
     * 타임아웃이 30초다. 트랜잭션 안에서 부르면 그동안 DB 커넥션 하나를 붙잡고 있게 되는데,
     * Hibernate 는 트랜잭션 시작 시점에 물리 커넥션을 잡으므로(provider_disables_autocommit
     * 을 켜지 않았다) 지연 획득으로 빠져나갈 수도 없다.
     *
     * <p>이 경로는 저학년이 가장 많이 누르는 버튼이다 — 문제를 스스로 읽기 어려워 문항마다
     * 스피커를 누른다. 동시 10명이면 기본 풀(10)이 그대로 마르고, 그 순간 로그인·제출·수업
     * 상태 조회까지 학급 전체가 커넥션을 못 얻어 함께 멈춘다. TTS 하나가 서비스를 세우는 셈이다.
     *
     * <p>그래서 ReportService·SubmissionService 가 쓰는 3단 분리를 그대로 따른다:
     * ① 검증(트랜잭션 없음) → ② 합성·파일 쓰기(트랜잭션 밖) → ③ 저장(리포지토리의 짧은 트랜잭션).
     * 저장 대상이 한 행뿐이고 {@code getReferenceById} 는 프록시만 만들므로 컨텍스트를
     * 열어 둘 이유가 없다.
     */
    public UploadResponse synthesize(AuthUser authUser, String text, String voice) {
        String trimmed = text == null ? "" : text.strip();
        int max = properties.maxChars() > 0 ? properties.maxChars() : 1000;
        if (trimmed.isEmpty() || trimmed.length() > max) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-tts-text",
                    "변환할 텍스트가 비었거나 너무 깁니다(최대 " + max + "자).");
        }

        String storageKey = cacheKey(trimmed, voice);
        Optional<UploadedFile> cached = uploadedFileRepository.findByStorageKey(storageKey);
        if (cached.isPresent()) {
            return UploadResponse.from(cached.get());
        }

        SynthesizedAudio audio = ttsProvider.synthesize(trimmed, voice);
        writeBytes(storageKey, audio.data());

        User uploader = userRepository.getReferenceById(authUser.id());
        try {
            UploadedFile saved = uploadedFileRepository.saveAndFlush(UploadedFile.of(
                    UUID.randomUUID(), uploader, FilePurpose.TTS_AUDIO,
                    "tts." + audio.extension(),
                    storageKey, audio.contentType(), audio.data().length));
            return UploadResponse.from(saved);
        } catch (DataIntegrityViolationException e) {
            /*
              storage_key UNIQUE 위반 — 같은 반 아이 둘이 같은 문항의 스피커를 동시에 눌렀다.
              둘 다 조회에서 "없음"을 보고 둘 다 합성한 것이다. 바이트는 같으므로 파일은
              그대로 두고, 먼저 넣은 쪽의 행을 쓴다. 실패시킬 이유가 없다.
            */
            return uploadedFileRepository.findByStorageKey(storageKey)
                    .map(UploadResponse::from)
                    .orElseThrow(() -> e);
        }
    }

    /**
     * 저장 키를 <b>내용에서 만든다</b> — 같은 문장·같은 음성이면 같은 키다.
     *
     * <p>예전에는 요청마다 랜덤 UUID 로 새 키를 만들고 새 행을 넣었다. 같은 텍스트를 찾아보는
     * 코드가 없었으므로, 저학년 아이가 한 문항에서 스피커를 세 번 누르면 같은 음성이 세 번
     * 합성되고 파일도 세 벌 쌓였다. 지우는 경로도 없다 — 백엔드 전체에 uploaded_file 삭제가
     * 0건이라 학급을 지워도 남는다. 운영 provider 가 GMS 라 합성마다 크레딧도 나간다.
     *
     * <p>{@link TtsProvider#cacheNamespace()} 를 섞는 것은 인터페이스가 정의해 두고도
     * 호출부가 없던 훅이다 — provider·모델이 바뀌면 키가 달라져 옛 음성을 재사용하지 않는다.
     *
     * <p>확장자를 키에 붙이지 않는다: 합성하기 <b>전에</b> 키가 필요한데(그래야 조회로 건너뛴다)
     * 확장자는 합성 결과라야 안다. 파일 타입은 {@code content_type} 컬럼이 들고 있고,
     * 다운로드 파일명은 {@code original_name} 이 들고 있어 잃는 정보가 없다.
     *
     * <p>앞 두 글자로 디렉터리를 나눈다 — 한 디렉터리에 수만 개가 쌓이면 목록 조회가 느려진다.
     */
    private String cacheKey(String text, String voice) {
        String material = ttsProvider.cacheNamespace() + "\n" + (voice == null ? "" : voice)
                + "\n" + text;
        String hash = HexFormat.of().formatHex(
                sha256().digest(material.getBytes(StandardCharsets.UTF_8)));
        return "%s/%s/%s".formatted(
                FilePurpose.TTS_AUDIO.name().toLowerCase(Locale.ROOT),
                hash.substring(0, 2),
                hash);
    }

    private MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 이 없는 JVM 은 없다", e);
        }
    }

    // FileStorage.store는 MultipartFile 전용이라, 생성한 바이트는 같은 저장 루트(resolve)에 직접 쓴다.
    private void writeBytes(String storageKey, byte[] data) {
        Path target = storage.resolve(storageKey);
        try {
            Files.createDirectories(target.getParent());
            Files.write(target, data);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "tts-store-failed",
                    "음성 파일을 저장하지 못했습니다.");
        }
    }
}
