package com.mallang.classroom.controller;

import com.mallang.classroom.dto.ClassroomDtos.ClassroomDetailResponse;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomMemberResponse;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomResponse;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomWithStudentsResponse;
import com.mallang.classroom.dto.ClassroomDtos.CreateClassroomRequest;
import com.mallang.classroom.dto.ClassroomDtos.CreateStudentRequest;
import com.mallang.classroom.dto.ClassroomDtos.StudentAccountResponse;
import com.mallang.classroom.dto.ClassroomDtos.StudentCsvRowResponse;
import com.mallang.classroom.dto.ClassroomDtos.StudentSummaryResponse;
import com.mallang.classroom.dto.ClassroomDtos.TransferOwnerRequest;
import com.mallang.classroom.dto.ClassroomDtos.UpdateClassroomRequest;
import com.mallang.classroom.service.ClassroomService;
import com.mallang.global.security.AuthUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.net.URI;
import java.util.List;

@Tag(name = "Classroom", description = "학급 — 생성/학생 계정 발급")
@RestController
@RequestMapping("/api/classrooms")
@RequiredArgsConstructor
public class ClassroomController {

    private final ClassroomService classroomService;

    @Operation(summary = "학급 생성 (생성자가 OWNER, 별칭 자동 배정)")
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ClassroomResponse> createClassroom(
            @AuthenticationPrincipal AuthUser authUser,
            @Valid @RequestBody CreateClassroomRequest request) {
        ClassroomResponse classroom = classroomService.createClassroom(authUser, request);
        return ResponseEntity.created(URI.create("/api/classrooms/" + classroom.id()))
                .body(classroom);
    }

    @Operation(summary = "학급 생성 + 학생 명단 CSV 동시 등록 — CSV 오류 시 학급도 롤백. "
            + "형식: 이름,학교,학년[,학부모이메일] (4번째 열은 선택)")
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ClassroomWithStudentsResponse> createClassroomWithStudents(
            @AuthenticationPrincipal AuthUser authUser,
            @RequestParam("name") String name,
            @RequestParam("grades") List<Short> grades,
            @RequestParam(value = "students", required = false) MultipartFile students) {
        ClassroomWithStudentsResponse classroom =
                classroomService.createClassroomWithStudents(authUser, name, grades, students);
        return ResponseEntity.created(URI.create("/api/classrooms/" + classroom.id()))
                .body(classroom);
    }

    @Operation(summary = "내가 속한 학급 목록 (선생님: 담당 학급 / 학생: 가입 학급)")
    @GetMapping
    public List<ClassroomResponse> listMyClassrooms(@AuthenticationPrincipal AuthUser authUser) {
        return classroomService.listMyClassrooms(authUser);
    }

    @Operation(summary = "학급 상세 (구성원 수·진행중 수업 포함, 멤버 전용)")
    @GetMapping("/{classroomId}")
    public ClassroomDetailResponse getClassroom(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return classroomService.getClassroom(authUser, classroomId);
    }

    @Operation(summary = "구성원 목록 (선생님 포함 — 역할·팀·학년, OWNER/MAINTAINER)")
    @GetMapping("/{classroomId}/members")
    public List<ClassroomMemberResponse> listMembers(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return classroomService.listMembers(authUser, classroomId);
    }

    @Operation(summary = "학생 명단 (OWNER/MAINTAINER — 임시 비밀번호는 미포함)")
    @GetMapping("/{classroomId}/students")
    public List<StudentSummaryResponse> listStudents(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        return classroomService.listStudents(authUser, classroomId);
    }

    @Operation(summary = "학급 정보 수정 (OWNER/MAINTAINER — 이름만, school 은 구성원에서 도출)")
    @PatchMapping("/{classroomId}")
    public ClassroomResponse updateClassroom(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @Valid @RequestBody UpdateClassroomRequest request) {
        return classroomService.updateClassroom(authUser, classroomId, request);
    }

    @Operation(summary = "학급 삭제 (OWNER 전용, soft delete)")
    @DeleteMapping("/{classroomId}")
    public ResponseEntity<Void> deleteClassroom(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        classroomService.deleteClassroom(authUser, classroomId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "구성원 제외 (학생 강퇴 / MAINTAINER 해제 — 팀 소속도 함께 정리)")
    @DeleteMapping("/{classroomId}/members/{userId}")
    public ResponseEntity<Void> removeMember(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @PathVariable Long userId) {
        classroomService.removeMember(authUser, classroomId, userId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "담당자 이양 (OWNER → MAINTAINER) — 넘긴 쪽은 MAINTAINER 가 된다")
    @PatchMapping("/{classroomId}/owner")
    public ResponseEntity<Void> transferOwner(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @Valid @RequestBody TransferOwnerRequest request) {
        classroomService.transferOwner(authUser, classroomId, request.newOwnerId());
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "학급 나가기 (본인) — 담당자(OWNER)는 이양 후에만 가능")
    @DeleteMapping("/{classroomId}/members/me")
    public ResponseEntity<Void> leave(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId) {
        classroomService.leave(authUser, classroomId);
        return ResponseEntity.noContent().build();
    }

    @Operation(summary = "학생 계정 직접 생성 (아이디/초기 비밀번호 발급·반환)")
    @PostMapping("/{classroomId}/students")
    public ResponseEntity<StudentAccountResponse> createStudent(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @Valid @RequestBody CreateStudentRequest request) {
        StudentAccountResponse account =
                classroomService.createStudent(authUser, classroomId, request);
        return ResponseEntity.created(URI.create("/api/users/" + account.userId()))
                .body(account);
    }

    @Operation(summary = "학생 계정 CSV 일괄 생성 — 형식: 이름,학교,학년[,학부모이메일] "
            + "(헤더 선택, UTF-8/CP949 자동 인식). 학부모이메일은 선택이며, 넣으면 아이디·임시 "
            + "비밀번호가 그 주소로도 발송된다(응답 후 비동기라 발송 결과는 응답에 없다)")
    @PostMapping(value = "/{classroomId}/students/bulk",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<List<StudentAccountResponse>> createStudentsBulk(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @RequestParam("file") MultipartFile file) {
        List<StudentAccountResponse> accounts =
                classroomService.createStudentsBulk(authUser, classroomId, file);
        return ResponseEntity.status(HttpStatus.CREATED).body(accounts);
    }

    @Operation(summary = "학생 CSV 미리보기 — 위 일괄 생성과 같은 파서로 읽기만 하고 계정은 "
            + "만들지 않는다. 등록 전에 무엇이 등록될지 확인하는 용도이며, 형식이 틀리면 "
            + "일괄 생성과 똑같이 400 과 행 번호를 돌려준다. 확인 뒤 같은 파일을 "
            + "/students/bulk 로 올리면 그때 등록된다")
    @PostMapping(value = "/{classroomId}/students/bulk/preview",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public List<StudentCsvRowResponse> previewStudentsBulk(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable Long classroomId,
            @RequestParam("file") MultipartFile file) {
        return classroomService.previewStudentsBulk(authUser, classroomId, file);
    }
}
