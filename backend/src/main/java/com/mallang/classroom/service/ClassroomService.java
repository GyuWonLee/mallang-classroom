package com.mallang.classroom.service;

import com.mallang.assignment.repository.AssignmentRepository;
import com.mallang.classroom.dto.ClassroomDtos.ActiveSession;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomDetailResponse;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomMemberResponse;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomResponse;
import com.mallang.classroom.dto.ClassroomDtos.ClassroomWithStudentsResponse;
import com.mallang.classroom.dto.ClassroomDtos.CreateClassroomRequest;
import com.mallang.classroom.dto.ClassroomDtos.CreateStudentRequest;
import com.mallang.classroom.dto.ClassroomDtos.MemberCounts;
import com.mallang.classroom.dto.ClassroomDtos.StudentAccountResponse;
import com.mallang.classroom.dto.ClassroomDtos.StudentCsvRowResponse;
import com.mallang.classroom.dto.ClassroomDtos.StudentSummaryResponse;
import com.mallang.classroom.dto.ClassroomDtos.UpdateClassroomRequest;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.classroom.repository.ClassroomRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.session.entity.LiveSession;
import com.mallang.session.repository.LiveSessionRepository;
import com.mallang.submission.repository.SubmissionRepository;
import com.mallang.team.repository.TeamMemberRepository;
import com.mallang.tutor.repository.AiTutorMemoryRepository;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ClassroomService {

    private final ClassroomRepository classroomRepository;
    private final ClassroomMemberRepository memberRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final UserRepository userRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final AliasGenerator aliasGenerator;
    private final StudentCsvParser csvParser;
    private final StudentAccountIssuer studentAccountIssuer;
    private final AssignmentRepository assignmentRepository;
    private final SubmissionRepository submissionRepository;
    private final ApplicationEventPublisher eventPublisher;
    /**
     * 학급을 떠날 때 말랑이 기억을 지우려고 든다. 대화 기록(AiTutorMessage)은 지우지 않는다 —
     * 그건 선생님이 살펴본 안전 신호의 근거라, 아이가 나갔다고 없앨 것이 아니다.
     * 여기서 지우는 것은 <b>다음 대화에 실릴 요약</b>뿐이다.
     */
    private final AiTutorMemoryRepository tutorMemoryRepository;

    @Transactional
    public ClassroomResponse createClassroom(AuthUser authUser, CreateClassroomRequest request) {
        Classroom classroom = openClassroom(authUser, request.name(), request.grades());
        return ClassroomResponse.of(classroom, ClassroomRole.OWNER);
    }

    /**
     * 학급 생성 + 학생 명단(CSV) 동시 등록 — 선생님의 실제 흐름("학급 만들면서 명단 주기").
     * 한 트랜잭션이라 CSV 한 행이라도 잘못되면 학급도 만들어지지 않는다 (빈 학급이 남지 않게).
     * csv 가 null/빈 파일이면 학급만 만든다.
     */
    @Transactional
    public ClassroomWithStudentsResponse createClassroomWithStudents(AuthUser authUser, String name,
                                                                     List<Short> grades,
                                                                     MultipartFile csv) {
        Classroom classroom = openClassroom(authUser, requireValidName(name),
                requireValidGrades(grades));
        List<StudentAccountResponse> students = (csv == null || csv.isEmpty())
                ? List.of()
                : issueStudentAccounts(classroom, csvParser.parse(csv));
        return new ClassroomWithStudentsResponse(classroom.getId(), classroom.getName(),
                classroom.getAlias(), ClassroomRole.OWNER.name(),
                List.copyOf(classroom.getGrades()), students);
    }

    /** 학급 개설 + 생성자를 OWNER 로 등록 (생성 경로 공통) */
    private Classroom openClassroom(AuthUser authUser, String name, List<Short> grades) {
        if (!authUser.isTeacher()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "teacher-only",
                    "학급은 선생님만 만들 수 있습니다.");
        }
        User teacher = userRepository.getReferenceById(authUser.id());
        Classroom classroom = classroomRepository.save(
                Classroom.create(name, aliasGenerator.generate(), grades));
        memberRepository.save(ClassroomMember.join(classroom, teacher, ClassroomRole.OWNER));
        return classroom;
    }

    // multipart 는 @Valid 가 걸리지 않으므로 JSON 경로와 같은 규칙(1~2개, 1~6학년)을 직접 검사
    private List<Short> requireValidGrades(List<Short> grades) {
        if (grades == null || grades.isEmpty() || grades.size() > 2) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-grades",
                    "담당 학년은 1~2개여야 합니다.");
        }
        if (grades.stream().anyMatch(grade -> grade == null || grade < 1 || grade > 6)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-grades",
                    "학년은 1~6이어야 합니다.");
        }
        return grades;
    }

    // multipart 는 @Valid 가 걸리지 않으므로 JSON 경로(CreateClassroomRequest)와 같은 규칙을 직접 검사
    private String requireValidName(String name) {
        String trimmed = name == null ? "" : name.strip();
        if (trimmed.isEmpty() || trimmed.length() > 50) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-classroom-name",
                    "학급 이름은 1~50자여야 합니다.");
        }
        return trimmed;
    }

    /**
     * 내가 속한 학급 목록 — 선생님은 담당 학급, 학생은 가입 학급 (명세 §2).
     *
     * <p>카드에 필요한 값(학생 수·진행중 수업·과제 진행률)을 함께 채운다(§11.2 #6).
     * 집계는 학급 id 목록을 한 번에 넘기는 쿼리 4개로 끝난다 — 학급이 몇 개든 왕복 수가 그대로다.</p>
     */
    public List<ClassroomResponse> listMyClassrooms(AuthUser authUser) {
        List<ClassroomMember> memberships =
                memberRepository.findWithClassroomByUserId(authUser.id());
        if (memberships.isEmpty()) {
            return List.of(); // in-절에 빈 목록을 넘기지 않는다
        }
        List<Long> classroomIds = memberships.stream()
                .map(member -> member.getClassroom().getId())
                .toList();

        Map<Long, Long> studentCounts = new HashMap<>();
        memberRepository.countStudentsByClassroomIds(classroomIds)
                .forEach(view -> studentCounts.put(view.getClassroomId(), view.getStudents()));

        /*
          카드에는 "수업 중"인지만 표시하므로 학급당 한 건이면 된다. 학년별 수업이 생기면서
          한 학급에 여러 건이 올 수 있는데, 먼저 온 것을 그대로 둔다(putIfAbsent) —
          어느 것을 집든 "수업 중"이라는 답은 같고, 뒤엣것으로 덮으면 목록을 새로 고칠 때마다
          카드의 수업 id 가 이유 없이 바뀐다.
        */
        Map<Long, ActiveSession> activeSessions = new HashMap<>();
        liveSessionRepository.findOpenByClassroomIds(classroomIds)
                .forEach(session -> activeSessions.putIfAbsent(session.getClassroom().getId(),
                        ActiveSession.from(session)));

        Map<Long, Long> publishedCounts = new HashMap<>();
        assignmentRepository.countPublishedByClassroomIds(classroomIds)
                .forEach(view -> publishedCounts.put(view.getClassroomId(), view.getPublished()));

        Map<Long, Long> submittedPairs = new HashMap<>();
        submissionRepository.countSubmittersByClassroomIds(classroomIds)
                .forEach(view -> submittedPairs.merge(
                        view.getClassroomId(), view.getSubmitters(), Long::sum));

        return memberships.stream()
                .map(member -> {
                    Long id = member.getClassroom().getId();
                    long students = studentCounts.getOrDefault(id, 0L);
                    return ClassroomResponse.of(member.getClassroom(), member.getRole(),
                            (int) students, activeSessions.get(id),
                            progress(students, publishedCounts.getOrDefault(id, 0L),
                                    submittedPairs.getOrDefault(id, 0L)));
                })
                .toList();
    }

    /**
     * 과제 진행률 — (제출한 학생·과제 쌍) / (학생 수 × 발행 과제 수).
     *
     * <p>낼 과제가 없거나 학생이 없으면 null 이다. 0% 로 내리면 화면에서 "다들 안 냈다"로 읽혀
     * 빨간 막대가 되는데, 그건 사실이 아니다(분모가 0이라 비율이 정의되지 않는다).</p>
     */
    private Integer progress(long students, long publishedAssignments, long submittedPairs) {
        long slots = students * publishedAssignments;
        if (slots == 0) {
            return null;
        }
        return (int) (submittedPairs * 100 / slots);
    }

    /** 학급 상세 — 구성원 수와 진행중 수업 포함 (멤버 전용) */
    public ClassroomDetailResponse getClassroom(AuthUser authUser, Long classroomId) {
        Classroom classroom = classroomRepository.findById(classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "classroom-not-found",
                        "학급을 찾을 수 없습니다."));
        ClassroomRole myRole = memberRepository.findByClassroomIdAndUserId(classroomId, authUser.id())
                .map(ClassroomMember::getRole)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));

        List<ClassroomMember> members = memberRepository.findWithUserByClassroomId(classroomId);
        long students = members.stream().filter(m -> m.getRole() == ClassroomRole.STUDENT).count();
        // 학급에는 school 컬럼이 없다 — OWNER 선생님의 소속을 학급 소속으로 노출 (명세 §2 응답 예시)
        String school = members.stream()
                .filter(m -> m.getRole() == ClassroomRole.OWNER)
                .map(m -> m.getUser().getSchool())
                .findFirst()
                .orElse(null);
        // 학년별로 여러 개가 열릴 수 있다(V31). activeSession 은 옛 화면을 위한 첫 건이다.
        List<ActiveSession> activeSessions = liveSessionRepository
                .findOpenWithStarterByClassroomId(classroomId).stream()
                .map(ActiveSession::from)
                .toList();

        return new ClassroomDetailResponse(classroom.getId(), classroom.getName(), school,
                myRole.name(), List.copyOf(classroom.getGrades()),
                new MemberCounts(members.size() - students, students),
                activeSessions.isEmpty() ? null : activeSessions.get(0), activeSessions);
    }

    /** 학급 정보 수정 (OWNER/MAINTAINER) — 현재 수정 가능한 항목은 이름뿐 */
    @Transactional
    public ClassroomResponse updateClassroom(AuthUser authUser, Long classroomId,
                                             UpdateClassroomRequest request) {
        Classroom classroom = classroomRepository.findById(classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "classroom-not-found",
                        "학급을 찾을 수 없습니다."));
        ClassroomRole myRole = requireManager(classroomId, authUser.id());
        classroom.rename(request.name());
        if (request.grades() != null) {
            classroom.replaceGrades(requireValidGrades(request.grades()));
        }
        return ClassroomResponse.of(classroom, myRole);
    }

    /**
     * 학급 삭제 (OWNER 전용) — soft delete. 학생 계정까지 함께 정리한다.
     *
     * 학생 계정을 지우는 이유: 학급 전용으로 발급된 아이디({별칭}01…)라 학급이 없어지면
     * 로그인할 곳이 없다. 선생님 계정은 다른 학급과 본인 로그인이 걸려 있어 건드리지 않는다.
     *
     * 순서가 중요하다 — 참조하는 쪽부터 지운다. 권한 검사에서 이미 멤버가 영속성 컨텍스트에
     * 올라와 있어서, 참조가 남은 채로 학급/계정을 지우면 flush 때
     * TransientPropertyValueException 으로 죽는다 (S15P11A407-122).
     */
    @Transactional
    public void deleteClassroom(AuthUser authUser, Long classroomId) {
        Classroom classroom = classroomRepository.findById(classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "classroom-not-found",
                        "학급을 찾을 수 없습니다."));
        if (requireManager(classroomId, authUser.id()) != ClassroomRole.OWNER) {
            throw new ApiException(HttpStatus.FORBIDDEN, "owner-only",
                    "학급 삭제는 OWNER만 가능합니다.");
        }

        List<ClassroomMember> members = memberRepository.findWithUserByClassroomId(classroomId);
        List<User> students = deletableStudents(members, classroomId);

        teamMemberRepository.deleteByClassroomId(classroomId);
        memberRepository.deleteAll(members);
        userRepository.deleteAll(students);
        classroomRepository.delete(classroom);
    }

    /** 이 학급에만 속한 학생 — 다른 학급에도 적을 둔 계정은 남의 학급이 망가지므로 제외한다 */
    private List<User> deletableStudents(List<ClassroomMember> members, Long classroomId) {
        List<User> students = members.stream()
                .filter(member -> member.getRole() == ClassroomRole.STUDENT)
                .map(ClassroomMember::getUser)
                .toList();
        if (students.isEmpty()) {
            return List.of();
        }
        Set<Long> keep = Set.copyOf(memberRepository.findUserIdsBelongingToOtherClassrooms(
                students.stream().map(User::getId).toList(), classroomId));
        return students.stream().filter(student -> !keep.contains(student.getId())).toList();
    }

    /**
     * 구성원 제외 (OWNER/MAINTAINER) — 학생 강퇴 / MAINTAINER 해제 (명세 §2).
     * 멤버십은 soft delete 지만 팀 소속은 행을 지운다 — 남기면 재등록이 유니크 제약에 걸린다.
     */
    @Transactional
    public void removeMember(AuthUser authUser, Long classroomId, Long userId) {
        requireManager(classroomId, authUser.id());
        ClassroomMember member = memberRepository.findByClassroomIdAndUserId(classroomId, userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "member-not-found",
                        "해당 구성원을 찾을 수 없습니다."));
        if (member.getRole() == ClassroomRole.OWNER) {
            throw new ApiException(HttpStatus.CONFLICT, "owner-not-removable",
                    "OWNER는 제외할 수 없습니다. 학급을 삭제하세요.");
        }
        teamMemberRepository.deleteByClassroomIdAndUserId(classroomId, userId);
        tutorMemoryRepository.deleteByClassroomIdAndStudentId(classroomId, userId);
        memberRepository.delete(member);
    }

    /**
     * 담당자 이양 (명세 §11.4 — 경로만 예약돼 있던 것). 학급을 만든 선생님이 학교를 옮기거나
     * 담임이 바뀌면 학급을 통째로 다시 만드는 것 말고는 길이 없었다. 담당자는 나갈 수도 없어
     * (leave 가 막는다) 이 API 가 그 매듭을 푼다.
     *
     * <p>두 행의 역할을 한 트랜잭션에서 함께 바꾼다 — 넘긴 쪽이 OWNER 로 남으면 담당자가 둘이 되고,
     * 받는 쪽이 안 바뀌면 담당자가 사라진다.</p>
     */
    @Transactional
    public void transferOwner(AuthUser authUser, Long classroomId, Long newOwnerId) {
        ClassroomMember owner = memberRepository
                .findByClassroomIdAndUserId(classroomId, authUser.id())
                .filter(member -> member.getRole() == ClassroomRole.OWNER)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "owner-only",
                        "학급 담당자만 이양할 수 있습니다."));
        if (newOwnerId.equals(authUser.id())) {
            throw new ApiException(HttpStatus.CONFLICT, "already-owner",
                    "이미 이 학급의 담당자입니다.");
        }
        ClassroomMember successor = memberRepository
                .findByClassroomIdAndUserId(classroomId, newOwnerId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "member-not-found",
                        "이 학급의 구성원이 아닙니다."));
        if (successor.getRole() != ClassroomRole.MAINTAINER) {
            // 학생이 담당자가 되면 학급 관리 권한이 통째로 넘어간다. 먼저 선생님으로 초대할 것.
            throw new ApiException(HttpStatus.BAD_REQUEST, "successor-not-teacher",
                    "학급 선생님(MAINTAINER)에게만 이양할 수 있습니다.");
        }
        successor.changeRole(ClassroomRole.OWNER);
        owner.changeRole(ClassroomRole.MAINTAINER);
    }

    /**
     * 학급 나가기 (본인) — 명세 §11.4 의 공백. 지금까지 학급을 떠나는 길은 선생님이 내보내는
     * 것뿐이라, 초대를 잘못 수락한 학생이 스스로 물릴 수 없었다.
     *
     * <p>정리 범위는 제외(removeMember)와 같고 권한 기준만 다르다 — 관리자가 아니라 본인이다.
     * OWNER 는 막는다: 나가 버리면 담당자 없는 학급이 남는다. 이양하거나 학급을 삭제해야 한다.</p>
     */
    @Transactional
    public void leave(AuthUser authUser, Long classroomId) {
        ClassroomMember member = memberRepository
                .findByClassroomIdAndUserId(classroomId, authUser.id())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));
        if (member.getRole() == ClassroomRole.OWNER) {
            throw new ApiException(HttpStatus.CONFLICT, "owner-cannot-leave",
                    "담당자는 학급을 나갈 수 없습니다. 담당자를 이양하거나 학급을 삭제하세요.");
        }
        teamMemberRepository.deleteByClassroomIdAndUserId(classroomId, authUser.id());
        tutorMemoryRepository.deleteByClassroomIdAndStudentId(classroomId, authUser.id());
        memberRepository.delete(member);
    }

    /** 구성원 목록 (OWNER/MAINTAINER) — 선생님 포함, 역할·팀·학년 (명세 §2) */
    public List<ClassroomMemberResponse> listMembers(AuthUser authUser, Long classroomId) {
        requireManager(classroomId, authUser.id());

        Map<Long, Long> teamByUserId = new HashMap<>();
        teamMemberRepository.findUserTeamsByClassroomId(classroomId)
                .forEach(view -> teamByUserId.put(view.getUserId(), view.getTeamId()));

        return memberRepository.findWithUserByClassroomId(classroomId).stream()
                .map(member -> {
                    User user = member.getUser();
                    return new ClassroomMemberResponse(user.getId(), user.getName(),
                            member.getRole().name(), teamByUserId.get(user.getId()),
                            user.getGrade());
                })
                .toList();
    }

    /** 학생 명단 (OWNER/MAINTAINER 전용) — 임시 비밀번호는 포함되지 않는다 */
    public List<StudentSummaryResponse> listStudents(AuthUser authUser, Long classroomId) {
        requireManager(classroomId, authUser.id());
        return memberRepository.findWithUserByClassroomId(classroomId).stream()
                .filter(member -> member.getRole() == ClassroomRole.STUDENT)
                .map(member -> StudentSummaryResponse.from(member.getUser()))
                .toList();
    }

    @Transactional
    public StudentAccountResponse createStudent(AuthUser authUser, Long classroomId,
                                                CreateStudentRequest request) {
        Classroom classroom = findManagedClassroom(authUser, classroomId);
        return issueStudentAccounts(classroom, List.of(request)).get(0);
    }

    // CSV 일괄 등록 — 한 트랜잭션: 한 행이라도 실패하면 전체 롤백 (부분 등록으로 인한 혼란 방지)
    @Transactional
    public List<StudentAccountResponse> createStudentsBulk(AuthUser authUser, Long classroomId,
                                                           MultipartFile file) {
        Classroom classroom = findManagedClassroom(authUser, classroomId);
        return issueStudentAccounts(classroom, csvParser.parse(file));
    }

    /**
     * CSV 미리보기 — 파일을 읽어 보기만 하고 <b>계정은 하나도 만들지 않는다.</b> 선생님이
     * 올린 파일이 무엇으로 읽혔는지 확인한 뒤 등록하게 하는 용도다.
     *
     * <p>읽는 일을 <b>서버의 같은 파서</b>에 맡기는 것이 이 메서드의 존재 이유다. 화면에서
     * 따로 CSV 를 해석하면 인코딩 판정(UTF-8/CP949)·헤더 인식·따옴표·학년 범위가 조금씩
     * 어긋나, "미리보기는 멀쩡했는데 등록은 실패한다"가 된다. 여기를 지나면 미리보기에서
     * 보인 것이 곧 등록될 것이다.</p>
     *
     * <p>잘못된 파일은 파서가 그대로 400 으로 던진다 — 몇 행이 왜 틀렸는지가 그 메시지에
     * 들어 있고, 그게 미리보기가 가장 쓸모 있는 순간이다.</p>
     *
     * <p>파일은 확인 뒤 한 번 더 올라온다. 서버에 담아 두면 그 사이 만료·정리를 관리해야
     * 하는데, 최대 100행짜리 텍스트라 다시 받는 편이 싸고 단순하다.</p>
     */
    public List<StudentCsvRowResponse> previewStudentsBulk(AuthUser authUser, Long classroomId,
                                                           MultipartFile file) {
        // 권한 확인은 등록과 똑같이 한다 — 남의 학급에 대고 명단을 읽어 볼 수 없어야 한다
        findManagedClassroom(authUser, classroomId);
        return csvParser.parse(file).stream().map(StudentCsvRowResponse::from).toList();
    }

    private Classroom findManagedClassroom(AuthUser authUser, Long classroomId) {
        Classroom classroom = classroomRepository.findById(classroomId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "classroom-not-found",
                        "학급을 찾을 수 없습니다."));
        requireManager(classroomId, authUser.id());
        return classroom;
    }

    /**
     * 학생 계정 발급 — 세 경로(학급 생성 동시 등록·CSV 벌크·단건)가 모두 여기를 지난다.
     *
     * <p>학부모 이메일이 있으면 안내 메일을 보내는데, <b>발송은 커밋된 뒤다.</b> 여기서 바로
     * 보내면 SMTP 타임아웃(건당 5초)이 트랜잭션 안으로 들어온다 — 30명이면 최대 150초 동안
     * DB 커넥션을 쥔 채 요청이 죽는다. 반대 방향도 중요하다: 메일이 실패해도 계정은 이미
     * 만들어졌고 롤백되면 안 된다. 선생님 화면의 안내장이 여전히 정본이다.
     */
    private List<StudentAccountResponse> issueStudentAccounts(Classroom classroom,
                                                              List<CreateStudentRequest> rows) {
        List<StudentAccountResponse> issued = new ArrayList<>(rows.size());
        List<IssuedAccount> mails = new ArrayList<>();
        for (CreateStudentRequest row : rows) {
            StudentAccountResponse account = studentAccountIssuer.issue(classroom, row);
            issued.add(account);
            if (row.parentEmail() != null && !row.parentEmail().isBlank()) {
                mails.add(new IssuedAccount(row.parentEmail(), account.name(),
                        account.username(), account.temporaryPassword()));
            }
        }
        // 학생 1명당 1건이 아니라 배치당 1건이다. 100명을 1건씩 올리면 비동기 큐가 넘쳐
        // CallerRuns 로 요청 스레드에 되돌아오고, 결국 응답이 메일 100통을 기다리게 된다.
        if (!mails.isEmpty()) {
            eventPublisher.publishEvent(
                    new StudentAccountsIssuedEvent(classroom.getName(), List.copyOf(mails)));
        }
        return issued;
    }

    /**
     * 안내 메일 한 통에 필요한 값. temporaryPassword 는 평문이다 — DB 에는 BCrypt 해시만
     * 있어 여기서만 알 수 있고, <b>로그에 남기면 안 된다.</b>
     */
    public record IssuedAccount(String parentEmail, String studentName,
                                String username, String temporaryPassword) {}

    /** 커밋 후 {@link StudentAccountMailSender} 가 받는다 */
    public record StudentAccountsIssuedEvent(String classroomName, List<IssuedAccount> accounts) {}

    // OWNER/MAINTAINER 멤버십 검증 — 모든 학급 관리 API의 공통 관문. 확인된 역할을 돌려준다
    private ClassroomRole requireManager(Long classroomId, Long userId) {
        ClassroomRole role = memberRepository.findByClassroomIdAndUserId(classroomId, userId)
                .map(ClassroomMember::getRole)
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "not-a-member",
                        "이 학급의 구성원이 아닙니다."));
        if (!role.canManage()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "manager-only",
                    "학급 관리자(OWNER/MAINTAINER)만 가능합니다.");
        }
        return role;
    }

}
