package com.mallang.file.service;

import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.file.dto.FileDtos.UploadResponse;
import com.mallang.file.entity.FilePurpose;
import com.mallang.file.entity.UploadedFile;
import com.mallang.file.repository.UploadedFileRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 파일 업로드·인증 다운로드 — S15P11A407-118 */
@ExtendWith(MockitoExtension.class)
class FileServiceTest {

    private static final List<ClassroomRole> MANAGE_ROLES =
            List.of(ClassroomRole.OWNER, ClassroomRole.MAINTAINER);

    @Mock UploadedFileRepository uploadedFileRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock UserRepository userRepository;

    @TempDir Path mediaRoot;

    private FileStorage storage;
    private FileService service;

    @BeforeEach
    void setUp() {
        storage = new FileStorage(mediaRoot.toString());
        service = new FileService(uploadedFileRepository, memberRepository, userRepository, storage);
    }

    @Test
    void uploadsAudioAndReturnsUuidBackedUrl() {
        MultipartFile audio = new MockMultipartFile("file", "말하기.m4a", "audio/mp4",
                "sound".getBytes());
        lenient().when(userRepository.getReferenceById(11L)).thenReturn(mock(User.class));
        when(uploadedFileRepository.save(any(UploadedFile.class))).thenAnswer(inv -> inv.getArgument(0));

        UploadResponse response = service.upload(student(11L), audio, FilePurpose.RECORDING);

        // 순번이 아닌 UUID 여야 남의 파일을 훑을 수 없다
        UUID parsed = UUID.fromString(response.fileId());
        assertThat(response.url()).isEqualTo("/api/files/" + parsed + "/content");
        assertThat(mediaRoot.resolve("recording")).exists();
    }

    @Test
    void rejectsWrongContentTypeForPurpose() {
        MultipartFile notAudio = new MockMultipartFile("file", "메모.txt", "text/plain",
                "hello".getBytes());

        assertThatThrownBy(() -> service.upload(student(11L), notAudio, FilePurpose.RECORDING))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("올릴 수 없는 형식");
        verify(uploadedFileRepository, never()).save(any());
    }

    @Test
    void rejectsLearningMaterialThroughGenericUpload() {
        MultipartFile pdf = new MockMultipartFile("file", "교과서.pdf", "application/pdf",
                "%PDF".getBytes());

        // 학습자료는 추출 파이프라인을 타야 하므로 6.5 API 로만 올릴 수 있다
        assertThatThrownBy(() -> service.upload(teacher(1L), pdf, FilePurpose.LEARNING_MATERIAL))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학습자료 API");
    }

    @Test
    void rejectsOversizedFile() {
        byte[] big = new byte[11 * 1024 * 1024];
        MultipartFile huge = new MockMultipartFile("file", "long.m4a", "audio/mp4", big);

        assertThatThrownBy(() -> service.upload(student(11L), huge, FilePurpose.RECORDING))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("10MB");
    }

    @Test
    void rejectsEmptyFile() {
        MultipartFile empty = new MockMultipartFile("file", "x.m4a", "audio/mp4", new byte[0]);

        assertThatThrownBy(() -> service.upload(student(11L), empty, FilePurpose.RECORDING))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("빈 파일");
    }

    @Test
    void ownerCanDownloadOwnFile() throws Exception {
        UUID id = UUID.randomUUID();
        UploadedFile file = storedFile(id, 11L, "recording/2026/07/" + id + ".m4a");
        when(uploadedFileRepository.findById(id)).thenReturn(Optional.of(file));

        FileService.Download download = service.download(student(11L), id);

        assertThat(download.contentType()).isEqualTo("audio/mp4");
        assertThat(download.resource().exists()).isTrue();
    }

    @Test
    void teacherOfUploaderClassroomCanDownload() throws Exception {
        UUID id = UUID.randomUUID();
        UploadedFile file = storedFile(id, 11L, "recording/2026/07/" + id + ".m4a");
        when(uploadedFileRepository.findById(id)).thenReturn(Optional.of(file));
        when(memberRepository.managesMember(1L, 11L, MANAGE_ROLES)).thenReturn(true);

        assertThat(service.download(teacher(1L), id).resource().exists()).isTrue();
    }

    @Test
    void otherStudentCannotDownloadRecording() throws Exception {
        UUID id = UUID.randomUUID();
        UploadedFile file = storedFile(id, 11L, "recording/2026/07/" + id + ".m4a");
        when(uploadedFileRepository.findById(id)).thenReturn(Optional.of(file));
        when(memberRepository.managesMember(12L, 11L, MANAGE_ROLES)).thenReturn(false);

        // 같은 반 학생이라도 남의 녹음은 못 듣는다 (명세 §9 접근 규칙)
        assertThatThrownBy(() -> service.download(student(12L), id))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("접근할 수 없습니다");
    }

    @Test
    void missingContentOnDiskIs404() {
        UUID id = UUID.randomUUID();
        UploadedFile file = fileEntity(id, 11L, "recording/2026/07/" + id + ".m4a");
        when(uploadedFileRepository.findById(id)).thenReturn(Optional.of(file));

        assertThatThrownBy(() -> service.download(student(11L), id))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("파일 내용을 찾을 수 없습니다");
    }

    @Test
    void storageKeyCannotEscapeRoot() {
        assertThatThrownBy(() -> storage.resolve("../../etc/passwd"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("잘못된 파일 경로");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser student(Long id) {
        return new AuthUser(id, Role.STUDENT, "학생A");
    }

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    private UploadedFile fileEntity(UUID id, Long uploaderId, String storageKey) {
        User uploader = mock(User.class);
        lenient().when(uploader.getId()).thenReturn(uploaderId);
        return UploadedFile.of(id, uploader, FilePurpose.RECORDING, "말하기.m4a",
                storageKey, "audio/mp4", 5L);
    }

    /** 메타데이터 + 실제 디스크 파일까지 만들어 둔 상태 */
    private UploadedFile storedFile(UUID id, Long uploaderId, String storageKey) throws Exception {
        Path path = mediaRoot.resolve(storageKey);
        Files.createDirectories(path.getParent());
        Files.writeString(path, "sound");
        return fileEntity(id, uploaderId, storageKey);
    }
}
