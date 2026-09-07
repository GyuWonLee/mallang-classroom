package com.mallang.file.repository;

import com.mallang.file.entity.UploadedFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface UploadedFileRepository extends JpaRepository<UploadedFile, UUID> {

    /**
     * 저장 키로 찾는다 — TTS 중복 합성을 막는 조회.
     *
     * <p>{@code storage_key} 는 {@code V7__uploaded_file.sql:10} 에서 UNIQUE 라, 키가 곧
     * 내용인 파일(같은 문장·같은 음성)에는 이 조회가 그대로 캐시가 된다.
     */
    Optional<UploadedFile> findByStorageKey(String storageKey);
}
