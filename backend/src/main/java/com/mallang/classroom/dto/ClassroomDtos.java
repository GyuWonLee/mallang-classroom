package com.mallang.classroom.dto;

import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.user.entity.User;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 학급 도메인 요청/응답 DTO 모음. (record + Bean Validation — AuthDtos와 동일 패턴)
 */
public class ClassroomDtos {

    /** 학급 생성 — 담당 학년은 1~2개 필수 (학년별 팀이 여기서 파생된다) */
    public record CreateClassroomRequest(
            @NotBlank @Size(max = 50) String name,
            @NotNull @Size(min = 1, max = 2, message = "담당 학년은 1~2개여야 합니다")
            List<@NotNull @Min(1) @Max(6) Short> grades
    ) {}

    /**
     * 학급 목록 항목.
     *
     * <p>studentCount·activeSession·assignmentProgress 는 카드에 바로 필요한 값이다(§11.2 #6).
     * 없을 때는 학급마다 상세를 다시 부르거나(왕복이 학급 수만큼) 아예 구할 수 없었다.</p>
     *
     * <p>assignmentProgress 는 0~100 이고, <b>발행 과제나 학생이 없으면 null</b> 이다 —
     * 0% 는 "다들 안 냈다"는 뜻이라 화면에서 빨간 막대가 되는데, 낼 게 없는 것과는 다르다.</p>
     */
    public record ClassroomResponse(
            Long id,
            String name,
            String alias,
            String myRole,
            List<Short> grades,
            int studentCount,
            ActiveSession activeSession,
            Integer assignmentProgress
    ) {
        /** 집계가 필요 없는 경로(생성 직후 등) — 카드 값은 비운다. */
        public static ClassroomResponse of(Classroom classroom, ClassroomRole myRole) {
            return of(classroom, myRole, 0, null, null);
        }

        public static ClassroomResponse of(Classroom classroom, ClassroomRole myRole,
                                           int studentCount, ActiveSession activeSession,
                                           Integer assignmentProgress) {
            return new ClassroomResponse(classroom.getId(), classroom.getName(),
                    classroom.getAlias(), myRole.name(), List.copyOf(classroom.getGrades()),
                    studentCount, activeSession, assignmentProgress);
        }
    }

    /**
     * 학급 생성 + CSV 학생 등록 응답. ClassroomResponse 의 필드를 그대로 포함하므로
     * 프론트가 기존 매퍼로 학급 부분을 읽고, students 는 계정 안내장 출력에 쓴다.
     * temporaryPassword 는 이 응답에서만 평문으로 나온다.
     */
    public record ClassroomWithStudentsResponse(
            Long id,
            String name,
            String alias,
            String myRole,
            List<Short> grades,
            List<StudentAccountResponse> students
    ) {}

    /**
     * 학급 상세 (명세 §2). school 은 학급 컬럼이 아니라 OWNER 선생님의 소속을 쓴다.
     */
    public record ClassroomDetailResponse(
            Long id,
            String name,
            String school,
            String myRole,
            List<Short> grades,
            MemberCounts memberCounts,
            // 낡은 필드다. 학년별 수업이 생기면서(V31) 한 학급에 여러 개가 열릴 수 있는데
            // 여기에는 그중 하나만 담긴다 — 새 화면은 아래 activeSessions 를 쓸 것.
            // 예전 화면이 아직 이 필드를 읽고 있어 한 버전 동안만 남겨 둔다.
            ActiveSession activeSession,
            /** 진행 중인 수업 전부 — 학년 오름차순. 없으면 빈 배열이다(null 아님). */
            List<ActiveSession> activeSessions
    ) {}

    public record MemberCounts(long teachers, long students) {}

    /** grade 는 학급 전체 수업이면 null (V31 이전 수업 포함). */
    /**
     * 진행 중인 수업 한 건.
     *
     * <p><b>시작한 선생님을 함께 싣는다.</b> 없을 때는 화면이 "내가 들어갈 수 있는 수업인지"를
     * 눌러 보기 전에는 알 수 없었다 — 동료가 연 수업에 들어가려다 403(not-session-teacher)을
     * 받고 나서야 잠갔다. 실패로 알아내는 것은 사용자에게 한 번의 헛걸음을 시키는 일이라,
     * 판단 근거를 응답에 담는다.</p>
     */
    public record ActiveSession(Long id, Short grade, LocalDateTime startedAt,
                                Long startedById, String startedByName) {

        public static ActiveSession from(com.mallang.session.entity.LiveSession session) {
            return new ActiveSession(session.getId(), session.getGrade(), session.getStartedAt(),
                    session.getStartedBy().getId(), session.getStartedBy().getName());
        }
    }

    /**
     * 학급 구성원 (선생님 포함). 학생 명단(StudentSummaryResponse)과 달리 아이디를 담지 않고
     * 역할·팀을 담는다 — 화면에서 "누가 어느 팀인지" 보여주는 용도.
     * teamId 는 미배정이면 null, grade 는 선생님이면 null (DB 제약상 학생만 학년 보유).
     */
    public record ClassroomMemberResponse(
            Long userId,
            String name,
            String role,
            Long teamId,
            Short grade
    ) {}

    /** 비밀번호 초기화 결과 — 평문은 이 응답에서만 1회 노출 */
    public record PasswordResetResponse(String username, String temporaryPassword) {}

    /**
     * 학생 명단 항목. 발급 응답(StudentAccountResponse)과 달리 temporaryPassword 가 없다 —
     * DB에는 BCrypt 해시만 있어 평문을 되돌릴 수 없기 때문(발급 시 1회만 노출).
     */
    public record StudentSummaryResponse(
            Long userId,
            String username,
            String name,
            String school,
            Short grade
    ) {
        public static StudentSummaryResponse from(User student) {
            return new StudentSummaryResponse(student.getId(), student.getUsername(),
                    student.getName(), student.getSchool(), student.getGrade());
        }
    }

    /**
     * 학급 정보 수정. school 은 학급 컬럼이 아니라 구성원(USER.school)에서 도출되므로
     * 프론트가 보내더라도 무시한다 (명세: 학급에 school 컬럼 없음 — 의도된 설계).
     */
    /** grades 를 주면 담당 학년도 교체한다 (생략 시 이름만 수정) */
    /** 담당자 이양 — 넘겨받을 선생님(MAINTAINER)의 사용자 id. */
    public record TransferOwnerRequest(@jakarta.validation.constraints.NotNull Long newOwnerId) {}

    public record UpdateClassroomRequest(
            @NotBlank @Size(max = 50) String name,
            @Size(min = 1, max = 2, message = "담당 학년은 1~2개여야 합니다")
            List<@NotNull @Min(1) @Max(6) Short> grades
    ) {}

    /**
     * 학생 발급 요청. parentEmail 은 선택 — 있으면 계정 안내 메일이 그 주소로 간다.
     * (CSV 4번째 열, 또는 단건 발급 JSON)
     */
    public record CreateStudentRequest(
            @NotBlank @Size(max = 30) String name,
            @NotBlank @Size(max = 50) String school,
            @NotNull @Min(1) @Max(6) Short grade,
            @Email @Size(max = 255) String parentEmail
    ) {
        /** 이메일 없이 만들던 기존 호출부(단건 발급·테스트)를 그대로 두기 위한 생성자 */
        public CreateStudentRequest(String name, String school, Short grade) {
            this(name, school, grade, null);
        }
    }

    /**
     * CSV 미리보기 한 행 — <b>아직 아무것도 만들지 않은</b>, 파일을 읽기만 한 결과다.
     *
     * <p>발급 응답({@link StudentAccountResponse})과 일부러 다른 타입이다. 저쪽에는 아이디와
     * 임시 비밀번호가 있는데, 여기에 그 모양을 쓰면 빈 칸을 채워 보내야 하고 화면은 "이미
     * 만들어졌다"고 읽는다. 미리보기에는 파일에 적힌 것만 있다.</p>
     */
    public record StudentCsvRowResponse(
            String name,
            String school,
            Short grade,
            /** 없으면 null — 안내 메일이 가지 않는 행이다 */
            String parentEmail
    ) {
        public static StudentCsvRowResponse from(CreateStudentRequest row) {
            return new StudentCsvRowResponse(row.name(), row.school(), row.grade(), row.parentEmail());
        }
    }

    /**
     * 학생 계정 발급 결과. temporaryPassword는 이 응답에서 단 한 번만 평문 노출 —
     * DB에는 BCrypt 해시만 저장되므로 선생님이 이 화면에서 안내장에 옮겨 적는 흐름.
     */
    public record StudentAccountResponse(
            Long userId,
            String username,
            String temporaryPassword,
            String name,
            String school,
            Short grade
    ) {
        public static StudentAccountResponse of(User student, String temporaryPassword) {
            return new StudentAccountResponse(student.getId(), student.getUsername(),
                    temporaryPassword, student.getName(), student.getSchool(), student.getGrade());
        }
    }
}
