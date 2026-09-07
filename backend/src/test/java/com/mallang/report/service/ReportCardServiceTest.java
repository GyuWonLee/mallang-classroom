package com.mallang.report.service;

import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.service.AssignmentAccessGuard;
import com.mallang.classroom.entity.Classroom;
import com.mallang.classroom.entity.ClassroomMember;
import com.mallang.classroom.entity.ClassroomRole;
import com.mallang.classroom.repository.ClassroomMemberRepository;
import com.mallang.global.error.ApiException;
import com.mallang.global.security.AuthUser;
import com.mallang.report.dto.ReportCardDtos.EmailReportCardRequest;
import com.mallang.report.dto.ReportCardDtos.EmailReportCardResponse;
import com.mallang.report.dto.ReportCardDtos.Entry;
import com.mallang.report.dto.ReportCardDtos.ReportCardResponse;
import com.mallang.report.dto.ReportCardDtos.ReportCardSummary;
import com.mallang.report.dto.ReportCardDtos.SaveReportCardRequest;
import com.mallang.report.dto.ReportDtos.TagStat;
import com.mallang.report.entity.ReportCard;
import com.mallang.report.repository.ReportCardRepository;
import com.mallang.report.service.ReportInsightService.ReportCardItem;
import com.mallang.report.service.ReportService.Aggregation;
import com.mallang.user.entity.Role;
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 생활통지표 (S15P11A407-145) — 과목별 평가요소 초안 생성, 저장 upsert, 열람 권한을 고정한다.
 */
@ExtendWith(MockitoExtension.class)
class ReportCardServiceTest {

    private static final Long CLASSROOM_ID = 5L;
    private static final Long STUDENT_ID = 20L;

    @Mock AssignmentAccessGuard accessGuard;
    @Mock ReportService reportService;
    @Mock ReportInsightService insightService;
    @Mock ReportCardRepository reportCardRepository;
    @Mock ClassroomMemberRepository memberRepository;
    @Mock UserRepository userRepository;
    @Mock ReportCardMailSender mailSender;

    private final ObjectMapper objectMapper = JsonMapper.builder().build();

    private ReportCardService service() {
        return new ReportCardService(accessGuard, reportService, insightService,
                reportCardRepository, memberRepository, userRepository, mailSender, objectMapper);
    }

    private ClassroomMember studentMember(Long id, String name, Short grade) {
        User user = mock(User.class);
        lenient().when(user.getId()).thenReturn(id);
        lenient().when(user.getName()).thenReturn(name);
        lenient().when(user.getGrade()).thenReturn(grade);
        ClassroomMember member = mock(ClassroomMember.class);
        lenient().when(member.getRole()).thenReturn(ClassroomRole.STUDENT);
        lenient().when(member.getUser()).thenReturn(user);
        return member;
    }

    private Aggregation agg(int overallTotal, List<String> strengths, List<String> weaknesses) {
        return new Aggregation(List.of(), strengths, weaknesses, 1, overallTotal, overallTotal, Map.of());
    }

    /** 개념별 채점 결과까지 담은 집계 — 통지표 평가 등급은 여기서 나온다 */
    private Aggregation aggWith(TagStat... stats) {
        int correct = 0;
        int total = 0;
        for (TagStat s : stats) {
            correct += s.correct();
            total += s.total();
        }
        return new Aggregation(List.of(stats), List.of(), List.of(), 1, correct, total, Map.of());
    }

    private TagStat tag(String name, int correct, int total) {
        return new TagStat(name, correct, total, Math.round(100f * correct / total));
    }

    private ReportCardItem item(String area, String element, String... concepts) {
        return new ReportCardItem(area, element, List.of(concepts));
    }

    private Entry entryOf(ReportCardResponse res, String subject, String area) {
        return res.entries().stream()
                .filter(e -> e.subject().equals(subject) && java.util.Objects.equals(e.area(), area))
                .findFirst().orElseThrow();
    }

    private AuthUser teacher() {
        return new AuthUser(1L, Role.TEACHER, "이선생");
    }

    /**
     * 통지표는 <b>과목당 한 줄이 아니라 영역별 여러 줄</b>이다.
     *
     * <p>실물 통지표의 한 과목에는 '문법 / 쓰기 / 문학' 처럼 영역이 여러 줄 들어가고, 줄마다
     * 평가요소와 평가 등급이 따로 붙는다. 예전에는 과목당 한 줄에 서술형 문장을 채웠는데,
     * 그건 통지표가 아니라 학생 상세 화면의 코멘트 모양이었다.</p>
     */
    @Test
    void draftMakesOneRowPerAreaNotPerSubject() {
        when(reportService.aggregate(anyLong(), anyLong(), any()))
                .thenReturn(agg(0, List.of(), List.of()));
        when(reportService.aggregate(CLASSROOM_ID, STUDENT_ID, Subject.KOREAN))
                .thenReturn(aggWith(tag("받침규칙", 1, 4), tag("맞춤법", 28, 31)));
        when(userRepository.findById(STUDENT_ID)).thenReturn(Optional.empty());
        when(insightService.reportCardItems(eq("국어"), any(), any())).thenReturn(List.of(
                item("문법", "받침이 있는 낱말을 바르게 읽고 쓰기", "받침규칙"),
                item("쓰기", "맞춤법에 맞게 문장 쓰기", "맞춤법")));

        ReportCardResponse res = service().draft(teacher(), CLASSROOM_ID, STUDENT_ID);

        // 국어 두 줄 + 데이터 없는 나머지 네 과목 한 줄씩
        assertThat(res.entries()).hasSize(2 + Subject.values().length - 1);
        assertThat(entryOf(res, "KOREAN", "문법").evalElement()).endsWith("쓰기");
        assertThat(entryOf(res, "MATH", null).evalElement()).isEmpty();
    }

    /**
     * 평가 등급은 <b>모델이 아니라 정답률</b>이 정한다.
     *
     * <p>등급은 학부모가 읽는 성적이라 지어내면 안 된다. 채점 결과가 이미 있으므로 서버가 센다.
     * 개념마다 문항 수가 달라 <b>가중</b>이어야 한다 — 1/4 과 28/31 을 단순 평균하면 58% 지만
     * 실제로는 29/35 = 83% 다.</p>
     */
    @Test
    void ratingComesFromAccuracyNotFromTheModel() {
        when(reportService.aggregate(anyLong(), anyLong(), any()))
                .thenReturn(agg(0, List.of(), List.of()));
        when(reportService.aggregate(CLASSROOM_ID, STUDENT_ID, Subject.KOREAN))
                .thenReturn(aggWith(tag("받침규칙", 1, 4), tag("맞춤법", 28, 31)));
        when(userRepository.findById(STUDENT_ID)).thenReturn(Optional.empty());
        when(insightService.reportCardItems(eq("국어"), any(), any())).thenReturn(List.of(
                item("문법", "받침이 있는 낱말을 바르게 읽고 쓰기", "받침규칙"),   // 1/4 = 25%
                item("쓰기", "맞춤법에 맞게 문장 쓰기", "맞춤법"),                 // 28/31 = 90%
                item("읽기", "글을 읽고 내용 파악하기", "받침규칙", "맞춤법")));    // 29/35 = 83%

        ReportCardResponse res = service().draft(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(entryOf(res, "KOREAN", "문법").rating()).isEqualTo("노력요함");
        assertThat(entryOf(res, "KOREAN", "쓰기").rating()).isEqualTo("매우잘함");
        assertThat(entryOf(res, "KOREAN", "읽기").rating()).isEqualTo("잘함");
    }

    /**
     * 모델이 개념 목록을 빼먹어도 등급이 비지 않는다 — 평가요소 문구에서 되짚는다.
     *
     * <p>같은 프롬프트인데 과목에 따라 `concepts` 를 채우기도 하고 빼먹기도 했다. 그때마다
     * 평가 칸이 통째로 비면 통지표가 반쪽이 된다. 문구에 개념 이름이 들어 있으면 건진다.</p>
     */
    @Test
    void ratingFallsBackToTheWordingWhenTheModelOmitsConcepts() {
        when(reportService.aggregate(anyLong(), anyLong(), any()))
                .thenReturn(agg(0, List.of(), List.of()));
        when(reportService.aggregate(CLASSROOM_ID, STUDENT_ID, Subject.MATH))
                .thenReturn(aggWith(tag("나눗셈", 1, 4)));
        when(userRepository.findById(STUDENT_ID)).thenReturn(Optional.empty());
        when(insightService.reportCardItems(eq("수학"), any(), any())).thenReturn(List.of(
                item("수와 연산", "나눗셈의 의미를 이해하고 문제 해결하기"))); // concepts 비어 있음

        ReportCardResponse res = service().draft(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(entryOf(res, "MATH", "수와 연산").rating()).isEqualTo("노력요함");
    }

    /** 근거가 될 개념을 못 찾으면 등급을 비운다 — 모르는 것을 '보통'으로 채우면 거짓 성적이 된다 */
    @Test
    void ratingIsLeftBlankWhenNothingBacksIt() {
        when(reportService.aggregate(anyLong(), anyLong(), any()))
                .thenReturn(agg(0, List.of(), List.of()));
        when(reportService.aggregate(CLASSROOM_ID, STUDENT_ID, Subject.MATH))
                .thenReturn(aggWith(tag("나눗셈", 1, 4)));
        when(userRepository.findById(STUDENT_ID)).thenReturn(Optional.empty());
        when(insightService.reportCardItems(eq("수학"), any(), any())).thenReturn(List.of(
                item("도형과 측정", "여러 가지 모양을 분류하여 설명하기"))); // 아는 개념이 문구에 없다

        ReportCardResponse res = service().draft(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(entryOf(res, "MATH", "도형과 측정").rating()).isNull();
    }

    @Test
    void saveUpsertsReportCard() {
        when(reportCardRepository.findByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());
        when(accessGuard.findClassroom(CLASSROOM_ID)).thenReturn(mock(Classroom.class));
        when(userRepository.getReferenceById(STUDENT_ID)).thenReturn(mock(User.class));
        List<Entry> entries = List.of(
                new Entry("KOREAN", "문법", "맞춤법을 잘합니다.", "매우잘함"));

        service().save(teacher(), CLASSROOM_ID, STUDENT_ID, new SaveReportCardRequest(entries));

        // 저장된 content 에 평가요소·평가가 담겨야 한다
        ArgumentCaptor<ReportCard> captor = ArgumentCaptor.forClass(ReportCard.class);
        verify(reportCardRepository).save(captor.capture());
        assertThat(captor.getValue().getContent()).contains("맞춤법을 잘합니다.").contains("매우잘함");
    }

    @Test
    void getReturnsEmptyBeforeAnySave() {
        when(accessGuard.requireMember(CLASSROOM_ID, 1L)).thenReturn(ClassroomRole.OWNER);
        when(reportCardRepository.findByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());

        ReportCardResponse res = service().get(teacher(), CLASSROOM_ID, STUDENT_ID);

        assertThat(res.entries()).isEmpty(); // 아직 안 만든 통지표 → 빈 값(에러 아님)
    }

    @Test
    void studentCannotSeeAnotherStudentsReportCard() {
        when(accessGuard.requireMember(CLASSROOM_ID, 99L)).thenReturn(ClassroomRole.STUDENT);

        assertThatThrownBy(() -> service().get(
                new AuthUser(99L, Role.STUDENT, "남의학생"), CLASSROOM_ID, STUDENT_ID))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("본인 또는 학급 선생님");
    }

    @Test
    void studentCanSeeTheirOwnReportCard() {
        lenient().when(accessGuard.requireMember(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(ClassroomRole.STUDENT);
        when(reportCardRepository.findByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());

        ReportCardResponse res = service().get(
                new AuthUser(STUDENT_ID, Role.STUDENT, "본인"), CLASSROOM_ID, STUDENT_ID);

        assertThat(res.studentId()).isEqualTo(STUDENT_ID);
    }

    // ── 학년 통지표 한 번에 보기 ──────────────────────────────────────────────

    @Test
    void listFiltersByGradeAndFlagsWhoHasReportCard() {
        // 1학년 둘(한 명은 통지표 저장됨), 3학년 하나 → grade=1 만 뽑히고 저장 여부가 표시돼야 한다
        ClassroomMember g1saved = studentMember(11L, "김하나", (short) 1);
        ClassroomMember g1none = studentMember(12L, "이두리", (short) 1);
        ClassroomMember g3 = studentMember(30L, "박세찬", (short) 3);
        when(memberRepository.findWithUserByClassroomId(CLASSROOM_ID))
                .thenReturn(List.of(g3, g1none, g1saved));

        ReportCard card = mock(ReportCard.class);
        User cardStudent = mock(User.class);
        when(cardStudent.getId()).thenReturn(11L);
        when(card.getStudent()).thenReturn(cardStudent);
        when(card.getContent()).thenReturn("{\"entries\":[{\"subject\":\"KOREAN\",\"rating\":\"잘함\"}]}");
        when(reportCardRepository.findByClassroomId(CLASSROOM_ID)).thenReturn(List.of(card));

        List<ReportCardSummary> res = service().list(teacher(), CLASSROOM_ID, (short) 1);

        assertThat(res).extracting(ReportCardSummary::studentId).containsExactly(11L, 12L); // 3학년 제외, 이름순
        assertThat(res.get(0).saved()).isTrue();
        assertThat(res.get(0).entries()).hasSize(1);
        assertThat(res.get(1).saved()).isFalse();
        assertThat(res.get(1).entries()).isEmpty();
    }

    @Test
    void listWithoutGradeReturnsWholeClass() {
        ClassroomMember g1 = studentMember(11L, "가", (short) 1);
        ClassroomMember g3 = studentMember(30L, "나", (short) 3);
        when(memberRepository.findWithUserByClassroomId(CLASSROOM_ID)).thenReturn(List.of(g1, g3));
        when(reportCardRepository.findByClassroomId(CLASSROOM_ID)).thenReturn(List.of());

        assertThat(service().list(teacher(), CLASSROOM_ID, null)).hasSize(2);
    }

    // ── 이메일 발송 ──────────────────────────────────────────────────────────

    @Test
    void emailAttachesPdfAndSends() {
        User student = mock(User.class);
        when(student.getName()).thenReturn("김하나");
        when(userRepository.findById(STUDENT_ID)).thenReturn(Optional.of(student));
        when(mailSender.isConfigured()).thenReturn(true);
        // "%PDF" 를 base64 로 — data URI 접두가 붙어도 벗겨져야 한다
        String pdfBase64 = "data:application/pdf;base64,JVBERg==";

        EmailReportCardResponse res = service().email(teacher(), CLASSROOM_ID, STUDENT_ID,
                new EmailReportCardRequest("parent@example.com", pdfBase64, null, null));

        assertThat(res.sent()).isTrue(); // 접수 즉시 성공(비동기 발송)
        ArgumentCaptor<byte[]> pdf = ArgumentCaptor.forClass(byte[].class);
        verify(mailSender).sendAsync(eq("parent@example.com"), any(), any(), pdf.capture(),
                eq("김하나_생활통지표.pdf"));
        assertThat(new String(pdf.getValue())).startsWith("%PDF"); // 접두 제거 후 디코딩됨
    }

    @Test
    void emailFallsBackToSavedContentWhenNoPdf() {
        User student = mock(User.class);
        when(student.getName()).thenReturn("김하나");
        when(userRepository.findById(STUDENT_ID)).thenReturn(Optional.of(student));
        ReportCard card = mock(ReportCard.class);
        when(card.getContent()).thenReturn(
                "{\"entries\":[{\"subject\":\"KOREAN\",\"rating\":\"잘함\",\"evalElement\":\"맞춤법을 잘합니다.\"}]}");
        when(reportCardRepository.findByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.of(card));
        when(mailSender.isConfigured()).thenReturn(true);

        service().email(teacher(), CLASSROOM_ID, STUDENT_ID,
                new EmailReportCardRequest("parent@example.com", null, null, null));

        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        // PDF 없으면 5번째 인자(pdf)는 null, 본문에 통지표 내용이 텍스트로 들어간다
        verify(mailSender).sendAsync(eq("parent@example.com"), any(), body.capture(), eq(null), any());
        assertThat(body.getValue()).contains("국어").contains("맞춤법을 잘합니다.");
    }

    @Test
    void emailRejectsWhenNothingToSend() {
        User student = mock(User.class);
        when(userRepository.findById(STUDENT_ID)).thenReturn(Optional.of(student));
        when(reportCardRepository.findByClassroomIdAndStudentId(CLASSROOM_ID, STUDENT_ID))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service().email(teacher(), CLASSROOM_ID, STUDENT_ID,
                new EmailReportCardRequest("parent@example.com", null, null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("보낼 통지표 내용이 없습니다");
        verify(mailSender, never()).sendAsync(any(), any(), any(), any(), any());
    }
}
