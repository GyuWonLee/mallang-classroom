package com.mallang.file.entity;

import com.mallang.user.entity.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 업로드된 파일의 메타데이터. 실제 바이트는 로컬 디스크에 있고 여기엔 경로 키만 둔다.
 * id 가 UUID 인 이유: URL 에 노출되는 외부 식별자라 순번이면 남의 파일을 훑어볼 수 있다.
 */
@Entity
@Table(name = "uploaded_file")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UploadedFile {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "uploader_id", nullable = false)
    private User uploader;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private FilePurpose purpose;

    @Column(nullable = false)
    private String originalName;

    @Column(nullable = false, unique = true)
    private String storageKey;

    @Column(nullable = false)
    private String contentType;

    @Column(nullable = false)
    private long sizeBytes;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    public static UploadedFile of(UUID id, User uploader, FilePurpose purpose, String originalName,
                                  String storageKey, String contentType, long sizeBytes) {
        UploadedFile file = new UploadedFile();
        file.id = id;
        file.uploader = uploader;
        file.purpose = purpose;
        file.originalName = originalName;
        file.storageKey = storageKey;
        file.contentType = contentType;
        file.sizeBytes = sizeBytes;
        file.createdAt = LocalDateTime.now();
        return file;
    }
}
