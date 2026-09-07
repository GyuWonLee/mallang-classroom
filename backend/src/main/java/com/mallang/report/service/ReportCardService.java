package com.mallang.report.service;

import com.mallang.assignment.entity.Subject;
import com.mallang.assignment.service.AssignmentAccessGuard;
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
import com.mallang.user.entity.User;
import com.mallang.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 생활통지표 (S15P11A407-145) — 선생님이 학생별로 과목·영역별 평가를 만든다.
 *
 * <p>초안(draft)은 각 과목에 대해 학생의 제출 데이터로 <b>평가요소 문장을 LLM 이 채워</b> 돌려준다
 * (데이터가 없는 과목은 빈칸 → 선생님이 직접 작성). 선생님이 평가요소를 고치고 평가 등급을 고른 뒤
 * 저장한다. 평가 생성은 학습 현황과 같은 부품({@link ReportService#aggregate}·{@link ReportInsightService})을
 * 과목별로 재활용한다.</p>
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ReportCardService {

    private final AssignmentAccessGuard accessGuard;
    private final ReportService reportService;
    private final ReportInsightService insightService;
    private final ReportCardRepository reportCardRepository;
    private final ClassroomMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final ReportCardMailSender mailSender;
    private final ObjectMapper objectMapper;

    /**
     * 등급을 매기기 위한 최소 문항 수 — 프론트 `lib/reportCard.ts` 의 MIN_SAMPLE 과 같은 값.
     * 한두 문항으로 등급을 매기면 찍어서 맞힌 것이 '매우잘함' 이 된다.
     */
    private static final int MIN_SAMPLE = 3;

    /** 저장용 문서 래퍼 — content(jsonb)에 {"entries":[...]} 로 담는다. */
    private record StoredContent(List<Entry> entries) {
    }

    /**
     * 통지표 초안 — 과목마다 학생 제출 기반으로 평가요소 문장을 LLM 이 채운다.
     * 제출 데이터가 없는 과목은 빈 문자열(선생님이 작성). 저장하지 않고 돌려만 준다.
     */
    public ReportCardResponse draft(AuthUser viewer, Long classroomId, Long studentId) {
        accessGuard.requireManager(classroomId, viewer.id());
        Integer grade = userRepository.findById(studentId)
                .map(u -> u.getGrade() == null ? null : (int) u.getGrade().shortValue())
                .orElse(null);

        List<Entry> entries = new ArrayList<>();
        for (Subject subject : Subject.values()) {
            Aggregation agg = reportService.aggregate(classroomId, studentId, subject);
            if (agg.overallTotal() == 0) {
                // 푼 것이 없는 과목은 빈 줄로 둔다 — 근거 없이 지어내지 않는다
                entries.add(new Entry(subject.name(), null, "", null));
                continue;
            }
            Map<String, TagStat> byTag = agg.tagStats().stream()
                    .collect(Collectors.toMap(TagStat::tag, s -> s, (a, b) -> a, LinkedHashMap::new));
            List<ReportCardItem> items = insightService.reportCardItems(
                    subject.label(), grade, agg.tagStats());

            if (items.isEmpty()) {
                entries.add(new Entry(subject.name(), null, "", null));
                continue;
            }
            for (ReportCardItem item : items) {
                entries.add(new Entry(subject.name(), item.area(), item.evalElement(),
                        rating(conceptsOf(item, byTag.keySet()), byTag)));
            }
        }
        return ReportCardResponse.of(studentId, entries);
    }

    /**
     * 이 항목이 다루는 개념 — 모델이 적어 준 것을 쓰되, <b>비면 평가요소 문구에서 찾는다.</b>
     *
     * <p>모델이 `concepts` 를 빼먹는 일이 실제로 있었다(같은 프롬프트인데 과목에 따라 갈렸다).
     * 그러면 등급 계산의 근거가 사라져 <b>평가 칸이 통째로 빈 채로</b> 나간다. 그런데 평가요소
     * 문구에는 "곱셈, 나눗셈, 소수의 원리를 이해하고…" 처럼 개념 이름이 대개 들어 있으므로,
     * 거기서 되짚으면 대부분 건진다. 모델 출력의 한 필드에 등급 전체를 걸지 않는다.</p>
     */
    private List<String> conceptsOf(ReportCardItem item, Set<String> known) {
        if (item.concepts() != null && !item.concepts().isEmpty()) {
            return item.concepts();
        }
        String element = item.evalElement() == null ? "" : item.evalElement();
        return known.stream().filter(element::contains).toList();
    }

    /**
     * 평가 등급 — <b>LLM 이 아니라 정답률이 정한다.</b>
     *
     * <p>등급은 학부모가 읽는 성적이다. 이미 채점 결과라는 사실이 있는데 모델에게 물어보면
     * 지어낸 값이 들어간다. 그 항목이 다루는 개념들의 <b>정답 문항 수 / 전체 문항 수</b> 로 낸다
     * (개념마다 문항 수가 달라 단순 평균이 아니라 가중이어야 한다).</p>
     *
     * <p>근거가 될 개념이 없거나 문항이 {@link #MIN_SAMPLE} 개 미만이면 {@code null} —
     * 빈 칸으로 두고 선생님이 고른다. 모르는 것을 '보통'으로 채우면 사실이 아닌 성적이 나가고,
     * 한두 문항으로 등급을 매기면 찍어서 맞힌 것이 '매우잘함'이 된다.</p>
     *
     * <p><b>경계값은 프론트(`lib/reportCard.ts` 의 ACHIEVEMENT_CUTS·MIN_SAMPLE)와 같아야 한다.</b>
     * 두 곳이 다르면 같은 학생이 초안에서는 '잘함', 화면에서 다시 계산하면 '보통' 이 된다.
     * 여기를 고치면 그쪽도 함께 고칠 것.</p>
     */
    private String rating(List<String> concepts, Map<String, TagStat> byTag) {
        int correct = 0;
        int total = 0;
        for (String tag : concepts) {
            TagStat stat = byTag.get(tag);
            if (stat != null) {
                correct += stat.correct();
                total += stat.total();
            }
        }
        if (total < MIN_SAMPLE) {
            return null;
        }
        int accuracy = Math.round(100f * correct / total);
        if (accuracy >= 90) {
            return "매우잘함";
        }
        if (accuracy >= 75) {
            return "잘함";
        }
        return accuracy >= 60 ? "보통" : "노력요함";
    }

    /** 선생님이 수정한 평가요소·평가를 저장(학급+학생당 한 장 upsert). */
    @Transactional
    public ReportCardResponse save(AuthUser viewer, Long classroomId, Long studentId,
                                   SaveReportCardRequest request) {
        accessGuard.requireManager(classroomId, viewer.id());
        String json = writeJson(request.entries());
        ReportCard card = reportCardRepository.findByClassroomIdAndStudentId(classroomId, studentId)
                .orElseGet(() -> ReportCard.of(
                        accessGuard.findClassroom(classroomId),
                        userRepository.getReferenceById(studentId),
                        json));
        card.updateContent(json);
        reportCardRepository.save(card);
        return ReportCardResponse.of(studentId, request.entries());
    }

    /** 통지표 조회 — 학급 선생님 또는 본인. 아직 저장 전이면 빈 통지표를 돌려준다(에러 아님). */
    public ReportCardResponse get(AuthUser viewer, Long classroomId, Long studentId) {
        ClassroomRole role = accessGuard.requireMember(classroomId, viewer.id());
        if (!role.canManage() && !viewer.id().equals(studentId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "report-card-forbidden",
                    "본인 또는 학급 선생님만 통지표를 볼 수 있습니다.");
        }
        return reportCardRepository.findByClassroomIdAndStudentId(classroomId, studentId)
                .map(card -> ReportCardResponse.of(studentId, readEntries(card.getContent())))
                .orElseGet(() -> ReportCardResponse.of(studentId, List.of()));
    }

    /**
     * 학년 통지표 한 번에 보기 — 학급 학생을 (선택한 학년으로 걸러) 통지표 저장 여부·내용과 함께 돌려준다.
     * grade 가 null 이면 학급 전체. 복식학급에서 한 학년 통지표를 한 화면에 모으기 위한 배치 조회.
     */
    public List<ReportCardSummary> list(AuthUser viewer, Long classroomId, Short grade) {
        accessGuard.requireManager(classroomId, viewer.id());
        Map<Long, ReportCard> byStudent = reportCardRepository.findByClassroomId(classroomId).stream()
                .collect(Collectors.toMap(card -> card.getStudent().getId(), Function.identity()));
        return memberRepository.findWithUserByClassroomId(classroomId).stream()
                .filter(member -> member.getRole() == ClassroomRole.STUDENT)
                .map(ClassroomMember::getUser)
                .filter(student -> grade == null || grade.equals(student.getGrade()))
                .sorted(Comparator
                        .comparing(User::getGrade, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(User::getName, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(student -> {
                    ReportCard card = byStudent.get(student.getId());
                    List<Entry> entries = card != null ? readEntries(card.getContent()) : List.of();
                    return new ReportCardSummary(student.getId(), student.getName(),
                            student.getGrade(), card != null, entries);
                })
                .toList();
    }

    /**
     * 통지표 이메일 발송 — 수신 주소는 선생님이 넣고(학생 이메일은 저장돼 있지 않음),
     * 전체 이미지 PDF(프론트 생성, base64)가 있으면 첨부한다. 없으면 저장된 통지표 내용을 본문으로.
     */
    @Transactional(readOnly = true)
    public EmailReportCardResponse email(AuthUser viewer, Long classroomId, Long studentId,
                                         EmailReportCardRequest request) {
        accessGuard.requireManager(classroomId, viewer.id());
        User student = userRepository.findById(studentId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "student-not-found",
                        "학생을 찾을 수 없습니다."));

        byte[] pdf = decodePdf(request.pdfBase64());
        List<Entry> saved = reportCardRepository.findByClassroomIdAndStudentId(classroomId, studentId)
                .map(card -> readEntries(card.getContent()))
                .orElseGet(List::of);
        if (pdf == null && saved.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "empty-report-card",
                    "보낼 통지표 내용이 없습니다. 먼저 통지표를 저장하거나 PDF 를 첨부해 주세요.");
        }

        // 설정 여부만 동기로 확인해 미설정이면 바로 알린다. 실제 전송은 비동기라 여기서 기다리지 않는다
        // — PDF 첨부 전송을 요청 스레드에서 기다리면 앞단 프록시가 ~25초에 끊어 '전송 실패'로 오인된다.
        if (!mailSender.isConfigured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "mail-not-configured",
                    "메일 발송이 아직 설정되지 않았습니다. 관리자에게 SMTP 설정을 요청해 주세요.");
        }

        String studentName = student.getName();
        String subject = "[말랑] " + studentName + " 생활통지표";
        String body = buildBody(studentName, request.message(), pdf == null ? saved : List.of());
        String filename = (request.filename() != null && !request.filename().isBlank())
                ? request.filename() : studentName + "_생활통지표.pdf";

        mailSender.sendAsync(request.recipientEmail(), subject, body, pdf, filename);
        return new EmailReportCardResponse(true, request.recipientEmail());
    }

    /** base64(선택적 data: URI 접두 포함)를 PDF 바이트로. 비어 있으면 null. 형식 오류면 400. */
    private byte[] decodePdf(String base64) {
        if (base64 == null || base64.isBlank()) {
            return null;
        }
        String payload = base64.contains(",") ? base64.substring(base64.indexOf(',') + 1) : base64;
        try {
            return Base64.getDecoder().decode(payload.strip());
        } catch (IllegalArgumentException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-pdf",
                    "첨부할 PDF 형식이 올바르지 않습니다.");
        }
    }

    /** 메일 본문 — 선생님이 쓴 인사말(없으면 기본) + PDF 가 없을 때만 통지표 내용을 텍스트로 덧붙인다. */
    private String buildBody(String studentName, String message, List<Entry> textEntries) {
        StringBuilder body = new StringBuilder();
        body.append((message != null && !message.isBlank()) ? message.strip()
                : studentName + " 학생의 생활통지표를 보내 드립니다.");
        if (!textEntries.isEmpty()) {
            body.append("\n\n── 생활통지표 ──\n");
            for (Entry entry : textEntries) {
                boolean hasEval = entry.evalElement() != null && !entry.evalElement().isBlank();
                boolean hasRating = entry.rating() != null && !entry.rating().isBlank();
                if (!hasEval && !hasRating) {
                    continue;
                }
                body.append("\n[").append(subjectLabel(entry.subject())).append("] ");
                if (hasRating) {
                    body.append(entry.rating()).append(hasEval ? " — " : "");
                }
                if (hasEval) {
                    body.append(entry.evalElement().strip());
                }
            }
        }
        body.append("\n\n- 말랑말랑 드림");
        return body.toString();
    }

    /** enum 이름을 한글 과목명으로(알 수 없으면 원문 유지) — 메일 본문은 학부모가 읽으므로 한글로. */
    private String subjectLabel(String subjectName) {
        try {
            return Subject.valueOf(subjectName).label();
        } catch (IllegalArgumentException | NullPointerException e) {
            return subjectName;
        }
    }

    private String writeJson(List<Entry> entries) {
        try {
            return objectMapper.writeValueAsString(new StoredContent(entries));
        } catch (JacksonException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid-report-card",
                    "통지표 내용을 저장할 수 없습니다.");
        }
    }

    private List<Entry> readEntries(String content) {
        try {
            StoredContent stored = objectMapper.readValue(content, StoredContent.class);
            return stored.entries() != null ? stored.entries() : List.of();
        } catch (JacksonException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "report-card-read-failed",
                    "통지표 내용을 읽을 수 없습니다.");
        }
    }
}
