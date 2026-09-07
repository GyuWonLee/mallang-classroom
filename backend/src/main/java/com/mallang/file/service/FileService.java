package com.mallang.file.service;

import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.file.dto.FileDtos.UploadResponse;
import com.mallang.file.entity.FilePurpose;
import com.mallang.file.entity.UploadedFile;
import com.mallang.file.repository.UploadedFileRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

/**
 * 파일 업로드·다운로드 (명세 §9). 바이트는 로컬 디스크, 메타데이터는 DB.
 *
 * 접근 규칙(v0.5): 소유자(업로더) + 업로더가 속한 학급의 선생님.
 * "공개된 과제에 참조된 파일은 학급 멤버 전원" 규칙은 과제 도메인이 생긴 뒤 추가한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class FileService {

    private static final List<ClassroomRole> MANAGE_ROLES =
            List.of(ClassroomRole.OWNER, ClassroomRole.MAINTAINER);

    private final UploadedFileRepository uploadedFileRepository;
    private final ClassroomMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final FileStorage storage;

    @Transactional
    public UploadResponse upload(AuthUser authUser, MultipartFile file, FilePurpose purpose) {
        if (!purpose.directlyUploadable()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "purpose-not-allowed",
                    "학습자료는 학습자료 API로 업로드해야 합니다.");
        }
        return UploadResponse.from(store(authUser, file, purpose));
    }

    /**
     * 도메인 API 전용 저장 — POST /files 로는 못 올리는 용도(학습자료 등)를 해당 도메인 서비스가 부른다.
     * 형식·크기 검증은 그대로 거치고 directlyUploadable 만 건너뛴다.
     */
    @Transactional
    public UploadedFile store(AuthUser authUser, MultipartFile file, FilePurpose purpose) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "empty-file", "빈 파일입니다.");
        }
        if (!purpose.allows(file.getContentType())) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported-content-type",
                    "%s 용도로 올릴 수 없는 형식입니다. (%s)".formatted(purpose.name(), file.getContentType()));
        }
        if (file.getSize() > purpose.maxSizeBytes()) {
            throw new ApiException(HttpStatus.CONTENT_TOO_LARGE, "file-too-large",
                    "최대 %dMB까지 올릴 수 있습니다.".formatted(purpose.maxSizeMb()));
        }

        UUID fileId = UUID.randomUUID();
        String storageKey = storage.store(file, purpose, fileId);
        User uploader = userRepository.getReferenceById(authUser.id());
        return uploadedFileRepository.save(UploadedFile.of(
                fileId, uploader, purpose, safeOriginalName(file.getOriginalFilename()),
                storageKey, file.getContentType(), file.getSize()));
    }

    /** 다운로드 대상 조회 — 권한 확인 포함 */
    public Download download(AuthUser authUser, UUID fileId) {
        UploadedFile file = uploadedFileRepository.findById(fileId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "file-not-found",
                        "파일을 찾을 수 없습니다."));
        requireReadable(authUser, file);

        Path path = storage.resolve(file.getStorageKey());
        if (!Files.isReadable(path)) {
            // DB 메타는 있는데 실제 파일이 없는 경우 (디스크 유실·수동 삭제)
            throw new ApiException(HttpStatus.NOT_FOUND, "file-content-missing",
                    "파일 내용을 찾을 수 없습니다.");
        }
        return new Download(new FileSystemResource(path), file.getContentType(),
                file.getOriginalName(), file.getSizeBytes());
    }

    private void requireReadable(AuthUser authUser, UploadedFile file) {
        /*
          TTS 음성만 소유자 검사에서 뺀다.

          이 파일들은 콘텐츠 주소화(storage_key = sha256(namespace+voice+text))로 한 문장당
          한 행만 남는다. 그러니 "소유자"는 그 문장의 스피커를 학급에서 가장 먼저 누른 아이일
          뿐이고, 같은 문항을 푸는 다른 아이는 남의 파일을 재생하게 된다 — 소유자 검사를
          그대로 두면 그 순간 403 이다.

          새 보안 결정이 아니라 명세 이행이다. docs/api-spec.md 가 "공개된 과제의 content 에
          참조된 파일(TTS 음성 등) → 해당 학급 멤버 전원"을 이미 권한 정책으로 못 박아 뒀다.
          내용도 아이가 이미 화면에서 읽고 있는 문장을 읽어 준 것뿐이고, id 는 추측할 수 없는
          UUID 다.

          RECORDING(학생 녹음)까지 열면 안 된다 — 그건 아이 목소리다. 용도 하나만 연다.
        */
        if (file.getPurpose() == FilePurpose.TTS_AUDIO) {
            return;
        }
        Long uploaderId = file.getUploader().getId();
        if (uploaderId.equals(authUser.id())) {
            return; // 소유자 본인
        }
        // 업로더가 속한 학급의 선생님인가 — 학생 녹음을 다른 학생이 듣지 못하게 하는 관문
        if (memberRepository.managesMember(authUser.id(), uploaderId, MANAGE_ROLES)) {
            return;
        }
        throw new ApiException(HttpStatus.FORBIDDEN, "file-forbidden",
                "이 파일에 접근할 수 없습니다.");
    }

    /** 표시용 원본 파일명 — 경로 구분자를 제거해 헤더 조작을 막는다 */
    private String safeOriginalName(String originalName) {
        if (originalName == null || originalName.isBlank()) {
            return "upload";
        }
        String name = originalName.replaceAll("[\\\\/\\r\\n\"]", "_").strip();
        return name.length() > 200 ? name.substring(name.length() - 200) : name;
    }

    public record Download(Resource resource, String contentType, String fileName, long sizeBytes) {
    }
}
