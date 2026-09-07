package com.mallang.material.service;

import com.mallang.assignment.entity.Subject;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.file.entity.FilePurpose;
import com.mallang.file.entity.UploadedFile;
import com.mallang.file.service.FileService;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.material.dto.MaterialDtos.MaterialDetailResponse;
import com.mallang.material.dto.MaterialDtos.MaterialSummaryResponse;
import com.mallang.material.dto.MaterialDtos.MaterialUploadResponse;
import com.mallang.material.entity.Material;
import com.mallang.material.entity.MaterialStatus;
import com.mallang.material.repository.MaterialRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * 학습자료 (명세 §6.5) — AI 과제 생성의 grounding 원천.
 * 업로드는 즉시 202 로 돌려주고 추출은 비동기로 돈다 (MaterialExtractionService).
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MaterialService {

    private static final int MAX_TITLE_LENGTH = 255;

    private final MaterialRepository materialRepository;
    private final ClassroomRepository classroomRepository;
    private final ClassroomMemberRepository memberRepository;
    private final FileService fileService;
    private final ApplicationEventPublisher eventPublisher;

    @Transactional
    /**
     * @param grade   몇 학년 자료인가. <b>선택</b> — 비우면 공용이라 어느 학년에서도 고를 수 있다.
     * @param subject 어느 과목인가. 학년과 같은 규칙이다.
     */
    public MaterialUploadResponse upload(AuthUser authUser, Long classroomId, MultipartFile file,
                                         Short grade, Subject subject) {
        Classroom classroom = requireManagedClassroom(authUser, classroomId);
        if (grade != null && !classroom.getGrades().contains(grade)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "grade-not-in-classroom",
                    "이 학급이 맡지 않는 학년입니다");
        }
        // PDF 만·20MB 검증은 FilePurpose.LEARNING_MATERIAL 규칙이 담당한다
        UploadedFile stored = fileService.store(authUser, file, FilePurpose.LEARNING_MATERIAL);
        Material material = materialRepository.save(
                Material.uploading(classroom, stored, titleOf(stored), grade, subject));

        // 커밋된 뒤에 추출이 시작돼야 비동기 스레드가 이 행을 볼 수 있다 (AFTER_COMMIT 리스너)
        eventPublisher.publishEvent(new MaterialUploadedEvent(material.getId()));
        return MaterialUploadResponse.from(material);
    }

    public List<MaterialSummaryResponse> list(AuthUser authUser, Long classroomId) {
        requireManager(classroomId, authUser.id());
        return materialRepository.findByClassroomId(classroomId).stream()
                .map(MaterialSummaryResponse::from)
                .toList();
    }

    /** 상태 + 추출 텍스트 미리보기 — 업로드 후 폴링 대상 */
    public MaterialDetailResponse get(AuthUser authUser, Long materialId) {
        Material material = findAccessible(authUser, materialId);
        return MaterialDetailResponse.from(material);
    }

    /** 미리보기 확인 → READY. 확인 전에는 생성에 쓸 수 없다 */
    @Transactional
    public MaterialDetailResponse confirm(AuthUser authUser, Long materialId) {
        Material material = findAccessible(authUser, materialId);
        if (material.getStatus() != MaterialStatus.PREVIEW) {
            throw new ApiException(HttpStatus.CONFLICT, "not-in-preview",
                    "미리보기 확인 단계의 자료만 승인할 수 있습니다. (현재: %s)"
                            .formatted(material.getStatus()));
        }
        material.confirm();
        return MaterialDetailResponse.from(material);
    }

    /** soft delete — 기존 과제의 sourceRef 가 이 자료를 참조하므로 행은 남긴다 */
    @Transactional
    public void delete(AuthUser authUser, Long materialId) {
        Material material = findAccessible(authUser, materialId);
        materialRepository.delete(material);
    }

    private Material findAccessible(AuthUser authUser, Long materialId) {
        Material material = materialRepository.findById(materialId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "material-not-found",
                        "학습자료를 찾을 수 없습니다."));
        requireManager(material.getClassroom().getId(), authUser.id());
        return material;
    }

    private Classroom requireManagedClassroom(AuthUser authUser, Long classroomId) {
        Classroom classroom = classroomRepository.findById(classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "classroom-not-found",
                        "학급을 찾을 수 없습니다."));
        requireManager(classroomId, authUser.id());
        return classroom;
    }

    private void requireManager(Long classroomId, Long userId) {
        ClassroomRole role = memberRepository.findByClassroomIdAndUserId(classroomId, userId)
                .map(ClassroomMember::getRole)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "manager-only",
                    "학습자료 관리는 OWNER/MAINTAINER만 가능합니다.");
        }
    }

    /** 기본 제목은 원본 파일명 (명세: 수정 가능 — 제목 수정 API 는 후속) */
    private String titleOf(UploadedFile file) {
        String name = file.getOriginalName();
        return name.length() > MAX_TITLE_LENGTH ? name.substring(0, MAX_TITLE_LENGTH) : name;
    }

    /** 업로드 완료 알림 — 추출 파이프라인의 시작점 */
    public record MaterialUploadedEvent(Long materialId) {
    }
}
