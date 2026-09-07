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
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TtsServiceTest {

    @Mock TtsProvider ttsProvider;
    @Mock FileStorage storage;
    @Mock UploadedFileRepository uploadedFileRepository;
    @Mock UserRepository userRepository;
    @Captor ArgumentCaptor<UploadedFile> fileCaptor;

    private TtsService service;
    private final AuthUser student = new AuthUser(1L, Role.STUDENT, "학생");

    @BeforeEach
    void setUp() {
        service = new TtsService(ttsProvider, storage, uploadedFileRepository, userRepository,
                new TtsProperties("stub", 1000, null));
    }

    @Test
    void generatesStoresAndReturnsFileUrl() throws Exception {
        Path target = Files.createTempDirectory("tts-test").resolve("out.mp3");
        when(ttsProvider.cacheNamespace()).thenReturn("stub");
        when(ttsProvider.synthesize("학교에 갔다", null))
                .thenReturn(new SynthesizedAudio(new byte[]{1, 2, 3}, "audio/mpeg", "mp3"));
        when(storage.resolve(anyString())).thenReturn(target);
        when(userRepository.getReferenceById(1L)).thenReturn(mock(User.class));
        when(uploadedFileRepository.findByStorageKey(anyString())).thenReturn(Optional.empty());
        when(uploadedFileRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        UploadResponse response = service.synthesize(student, "학교에 갔다", null);

        // 바이트가 실제 저장되고, 파일 도메인과 동일한 응답 shape
        assertThat(Files.exists(target)).isTrue();
        assertThat(response.url()).isEqualTo("/api/files/" + response.fileId() + "/content");

        verify(uploadedFileRepository).saveAndFlush(fileCaptor.capture());
        assertThat(fileCaptor.getValue().getPurpose()).isEqualTo(FilePurpose.TTS_AUDIO);
        assertThat(fileCaptor.getValue().getContentType()).isEqualTo("audio/mpeg");
    }

    /**
     * 저학년 아이는 한 문항에서 스피커를 여러 번 누른다. 예전에는 그때마다 새로 합성하고
     * 파일도 새로 쌓였다 — 운영 provider 가 GMS 라 크레딧까지 나간다.
     */
    @Test
    void theSameSentenceIsSynthesizedOnlyOnce() {
        UploadedFile existing = mock(UploadedFile.class);
        when(existing.getId()).thenReturn(java.util.UUID.randomUUID());
        when(ttsProvider.cacheNamespace()).thenReturn("stub");
        when(uploadedFileRepository.findByStorageKey(anyString()))
                .thenReturn(Optional.of(existing));

        service.synthesize(student, "학교에 갔다", null);

        verify(ttsProvider, never()).synthesize(any(), any());
        verify(uploadedFileRepository, never()).saveAndFlush(any());
    }

    /** 음성이 다르면 다른 파일이다 — 키에 voice 가 섞여 있어야 한다 */
    @Test
    void adifferentVoiceIsADifferentFile() {
        when(ttsProvider.cacheNamespace()).thenReturn("stub");
        when(uploadedFileRepository.findByStorageKey(anyString())).thenReturn(Optional.empty());
        when(ttsProvider.synthesize(anyString(), any()))
                .thenReturn(new SynthesizedAudio(new byte[]{1}, "audio/mpeg", "mp3"));
        when(storage.resolve(anyString())).thenAnswer(inv -> tempFileFor(inv.getArgument(0)));
        when(userRepository.getReferenceById(1L)).thenReturn(mock(User.class));
        when(uploadedFileRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

        service.synthesize(student, "학교에 갔다", "alloy");
        service.synthesize(student, "학교에 갔다", "nova");

        ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
        verify(uploadedFileRepository, times(2)).findByStorageKey(keys.capture());
        assertThat(keys.getAllValues().get(0)).isNotEqualTo(keys.getAllValues().get(1));
    }

    /**
     * 같은 반 아이 둘이 같은 문항의 스피커를 동시에 눌렀다 — 둘 다 "없음"을 보고 둘 다 합성한다.
     * storage_key 가 UNIQUE 라 뒤늦은 쪽이 위반을 맞는데, 바이트는 같으므로 실패시킬 이유가 없다.
     */
    @Test
    void aConcurrentDuplicateFallsBackToTheRowThatWonTheRace() throws Exception {
        UploadedFile winner = mock(UploadedFile.class);
        when(winner.getId()).thenReturn(java.util.UUID.randomUUID());
        Path target = Files.createTempDirectory("tts-race").resolve("out.mp3");
        when(ttsProvider.cacheNamespace()).thenReturn("stub");
        when(uploadedFileRepository.findByStorageKey(anyString()))
                .thenReturn(Optional.empty(), Optional.of(winner));
        when(ttsProvider.synthesize(anyString(), any()))
                .thenReturn(new SynthesizedAudio(new byte[]{1}, "audio/mpeg", "mp3"));
        when(storage.resolve(anyString())).thenReturn(target);
        when(userRepository.getReferenceById(1L)).thenReturn(mock(User.class));
        when(uploadedFileRepository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("uq storage_key"));

        assertThat(service.synthesize(student, "학교에 갔다", null).fileId())
                .hasToString(winner.getId().toString());
    }

    private Path tempFileFor(String storageKey) throws Exception {
        return Files.createTempDirectory("tts-key").resolve(
                storageKey.substring(storageKey.lastIndexOf('/') + 1));
    }

    @Test
    void rejectsBlankText() {
        assertThatThrownBy(() -> service.synthesize(student, "   ", null))
                .isInstanceOf(ApiException.class);
        verify(ttsProvider, never()).synthesize(any(), any());
    }
}
