package com.mallang.material.service;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.assignment.entity.Subject;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.file.entity.FilePurpose;
import com.mallang.file.entity.UploadedFile;
import com.mallang.file.service.FileService;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.material.dto.MaterialDtos.MaterialDetailResponse;
import com.mallang.material.dto.MaterialDtos.MaterialUploadResponse;
import com.mallang.material.entity.ExtractionSource;
import com.mallang.material.entity.Material;
import com.mallang.material.entity.MaterialStatus;
import com.mallang.material.repository.MaterialRepository;
import com.mallang.material.service.MaterialService.MaterialUploadedEvent;
import com.mallang.user.entity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 학습자료 업로드·미리보기·확인·삭제 — S15P11A407-119 */
@ExtendWith(MockitoExtension.class)
class MaterialServiceTest {

    @Mock MaterialRepository materialRepository;
    @Mock ClassroomRepository classroomRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock FileService fileService;
    @Mock ApplicationEventPublisher eventPublisher;
    @InjectMocks MaterialService service;

    private Classroom classroom;

    @BeforeEach
    void setUp() {
        classroom = mock(Classroom.class);
        lenient().when(classroom.getId()).thenReturn(7L);
    }

    @Test
    void uploadStoresPdfAndKicksOffExtraction() {
        managerIs(1L, ClassroomRole.OWNER);
        MultipartFile pdf = new MockMultipartFile("file", "3학년국어.pdf",
                "application/pdf", "%PDF-1.4".getBytes());
        UploadedFile stored = uploadedFile("3학년국어.pdf");
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(fileService.store(any(), eq(pdf), eq(FilePurpose.LEARNING_MATERIAL))).thenReturn(stored);
        when(materialRepository.save(any(Material.class))).thenAnswer(inv -> inv.getArgument(0));

        MaterialUploadResponse response = service.upload(teacher(1L), 7L, pdf, null, null);

        // 추출 전이라 아직 PROCESSING — 응답은 202 로 즉시 나간다
        assertThat(response.status()).isEqualTo("PROCESSING");
        verify(eventPublisher).publishEvent(any(MaterialUploadedEvent.class));
    }

    /**
     * 올릴 때 고른 학년·과목이 자료에 남는다 — 과제 만들기에서 목록을 좁히는 근거다.
     *
     * <p>없던 때는 학년을 골라도 학급의 자료가 전부 떠서, 비슷한 이름들 사이에서 무엇으로
     * 문제를 만드는지 선생님이 일일이 기억해야 했다.</p>
     */
    @Test
    void uploadKeepsChosenGradeAndSubject() {
        managerIs(1L, ClassroomRole.OWNER);
        MultipartFile pdf = new MockMultipartFile("file", "3학년국어.pdf",
                "application/pdf", "%PDF-1.4".getBytes());
        UploadedFile stored = uploadedFile("3학년국어.pdf");
        when(classroom.getGrades()).thenReturn(java.util.Set.of((short) 3));
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        when(fileService.store(any(), eq(pdf), eq(FilePurpose.LEARNING_MATERIAL))).thenReturn(stored);
        when(materialRepository.save(any(Material.class))).thenAnswer(inv -> inv.getArgument(0));

        service.upload(teacher(1L), 7L, pdf, (short) 3, Subject.KOREAN);

        org.mockito.ArgumentCaptor<Material> captor =
                org.mockito.ArgumentCaptor.forClass(Material.class);
        verify(materialRepository).save(captor.capture());
        assertThat(captor.getValue().getGrade()).isEqualTo((short) 3);
        assertThat(captor.getValue().getSubject()).isEqualTo(Subject.KOREAN);
    }

    /** 학급이 맡지 않는 학년으로는 못 올린다 — 목록에 영영 안 뜰 자료가 된다 */
    @Test
    void cannotUploadForAGradeTheClassroomDoesNotTeach() {
        managerIs(1L, ClassroomRole.OWNER);
        MultipartFile pdf = new MockMultipartFile("file", "x.pdf", "application/pdf", "%PDF".getBytes());
        when(classroom.getGrades()).thenReturn(java.util.Set.of((short) 1));
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));

        assertThatThrownBy(() -> service.upload(teacher(1L), 7L, pdf, (short) 6, null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("학년");
        verify(fileService, never()).store(any(), any(), any());
    }

    @Test
    void studentCannotUploadMaterial() {
        managerIs(5L, ClassroomRole.STUDENT);
        when(classroomRepository.findById(7L)).thenReturn(Optional.of(classroom));
        MultipartFile pdf = new MockMultipartFile("file", "x.pdf", "application/pdf", "%PDF".getBytes());

        assertThatThrownBy(() -> service.upload(teacher(5L), 7L, pdf, null, null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("OWNER/MAINTAINER");
        verify(fileService, never()).store(any(), any(), any());
    }

    @Test
    void detailExposesPreviewAndTotalLength() {
        managerIs(1L, ClassroomRole.OWNER);
        Material material = extractedMaterial("본문 ".repeat(1500));
        when(materialRepository.findById(3L)).thenReturn(Optional.of(material));

        MaterialDetailResponse detail = service.get(teacher(1L), 3L);

        assertThat(detail.status()).isEqualTo("PREVIEW");
        assertThat(detail.extractionSource()).isEqualTo("TEXT_LAYER");
        // 미리보기는 잘라서 주고, 전체 분량은 따로 알린다
        assertThat(detail.preview()).hasSize(Material.PREVIEW_LENGTH);
        assertThat(detail.extractedLength()).isEqualTo(4500);
        /*
          원본 PDF 의 파일 id — 확인 화면이 이걸로 PDF 를 그대로 띄운다.
          추출 텍스트만 보여 주던 때는 선생님이 "이게 내가 올린 그 자료가 맞나"를 판단할
          근거가 약했다.
        */
        assertThat(detail.fileId()).isEqualTo(FILE_ID.toString());
    }

    @Test
    void confirmMovesPreviewToReady() {
        managerIs(1L, ClassroomRole.OWNER);
        Material material = extractedMaterial("본문");
        when(materialRepository.findById(3L)).thenReturn(Optional.of(material));

        MaterialDetailResponse detail = service.confirm(teacher(1L), 3L);

        assertThat(detail.status()).isEqualTo("READY");
        assertThat(material.getStatus().usableForGeneration()).isTrue();
    }

    @Test
    void confirmBeforeExtractionIsConflict() {
        managerIs(1L, ClassroomRole.OWNER);
        Material processing = Material.uploading(classroom, uploadedFile("x.pdf"), "x.pdf");
        when(materialRepository.findById(3L)).thenReturn(Optional.of(processing));

        assertThatThrownBy(() -> service.confirm(teacher(1L), 3L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("미리보기 확인 단계");
    }

    @Test
    void confirmFailedMaterialIsConflict() {
        managerIs(1L, ClassroomRole.OWNER);
        Material failed = Material.uploading(classroom, uploadedFile("scan.pdf"), "scan.pdf");
        failed.fail("스캔본으로 보입니다.");
        when(materialRepository.findById(3L)).thenReturn(Optional.of(failed));

        assertThatThrownBy(() -> service.confirm(teacher(1L), 3L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("FAILED");
    }

    @Test
    void deleteIsSoftDelete() {
        managerIs(1L, ClassroomRole.OWNER);
        Material material = extractedMaterial("본문");
        when(materialRepository.findById(3L)).thenReturn(Optional.of(material));

        service.delete(teacher(1L), 3L);

        // @SQLDelete 가 UPDATE ... deleted_at 으로 바꿔준다 — 과제의 sourceRef 가 참조하기 때문
        verify(materialRepository).delete(material);
    }

    @Test
    void otherClassroomManagerCannotRead() {
        Material material = extractedMaterial("본문");
        when(materialRepository.findById(3L)).thenReturn(Optional.of(material));
        when(memberRepository.findByClassroomIdAndUserId(7L, 99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.get(teacher(99L), 3L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("구성원이 아닙니다");
    }

    // ── 픽스처 ────────────────────────────────────────────────────────────────

    private AuthUser teacher(Long id) {
        return new AuthUser(id, Role.TEACHER, "이선생");
    }

    /** 응답이 원본 PDF 의 파일 id 를 싣는다 — 화면이 그걸로 PDF 를 띄운다 */
    private static final java.util.UUID FILE_ID =
            java.util.UUID.fromString("11111111-2222-3333-4444-555555555555");

    private UploadedFile uploadedFile(String name) {
        UploadedFile file = mock(UploadedFile.class);
        lenient().when(file.getOriginalName()).thenReturn(name);
        lenient().when(file.getId()).thenReturn(FILE_ID);
        return file;
    }

    private Material extractedMaterial(String text) {
        Material material = Material.uploading(classroom, uploadedFile("lesson.pdf"), "lesson.pdf");
        material.previewReady(text, ExtractionSource.TEXT_LAYER);
        return material;
    }

    private void managerIs(Long userId, ClassroomRole role) {
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(role);
        lenient().when(memberRepository.findByClassroomIdAndUserId(7L, userId))
                .thenReturn(Optional.of(member));
    }
}
