package com.mallang.file.service;

import com.mallang.file.entity.FilePurpose;
import com.mallang.global.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.UUID;

/**
 * 파일 바이트 저장소 — EC2 로컬 디스크 (팀 확정, S3 미사용).
 * 저장 루트는 Nginx 정적 경로에 두지 않는다: 다운로드는 항상 Spring 이 권한을 확인한 뒤 스트리밍한다.
 *
 * 저장 키 형식: {purpose}/{yyyy/MM}/{uuid}.{ext} — 한 디렉터리에 파일이 무한정 쌓이지 않게 월 단위로 쪼갠다.
 */
@Component
public class FileStorage {

    private static final DateTimeFormatter MONTH_PATH = DateTimeFormatter.ofPattern("yyyy/MM");

    private final Path root;

    public FileStorage(@Value("${mallang.media.root}") String root) {
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    /** 저장 후 storage_key 를 돌려준다 (DB에는 이 키만 남고 절대 경로는 설정과 조합) */
    public String store(MultipartFile file, FilePurpose purpose, UUID fileId) {
        String key = "%s/%s/%s%s".formatted(
                purpose.name().toLowerCase(Locale.ROOT),
                LocalDate.now().format(MONTH_PATH),
                fileId,
                extensionOf(file.getOriginalFilename()));
        Path target = resolve(key);
        try {
            Files.createDirectories(target.getParent());
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "file-store-failed",
                    "파일을 저장하지 못했습니다.");
        }
        return key;
    }

    public Path resolve(String storageKey) {
        Path path = root.resolve(storageKey).normalize();
        // 저장 키가 어떤 경로로 조합되든 루트 밖으로 나가지 못하게 (../ 방어)
        if (!path.startsWith(root)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-storage-key",
                    "잘못된 파일 경로입니다.");
        }
        return path;
    }

    /**
     * 확장자 추출 — 원본 파일명은 사용자 입력이라 그대로 경로에 쓰지 않는다.
     * 영숫자 1~8자만 통과시키고 나머지는 확장자 없음으로 처리한다.
     */
    private String extensionOf(String originalName) {
        if (originalName == null) {
            return "";
        }
        int dot = originalName.lastIndexOf('.');
        if (dot < 0 || dot == originalName.length() - 1) {
            return "";
        }
        String ext = originalName.substring(dot + 1);
        return ext.matches("[a-zA-Z0-9]{1,8}") ? "." + ext.toLowerCase(Locale.ROOT) : "";
    }
}
