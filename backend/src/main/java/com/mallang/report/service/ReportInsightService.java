package com.mallang.report.service;

import com.mallang.global.http.ExternalHttpClients;
import com.mallang.report.dto.ReportDtos.TagStat;
import com.mallang.assignment.ai.AiProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;

import java.time.Duration;

/**
 * 리포트 격려·조언 코멘트 생성. ai.provider=openai(SSAFY GMS)면 LLM으로, 아니면(키 없음/실패) 템플릿으로.
 * 명세 §8: 코멘트에는 숫자를 넣지 않는다(수치는 전부 집계로 별도 표시).
 */
@Slf4j
@Service
public class ReportInsightService {

    private final AiProperties properties;
    private final ObjectMapper objectMapper;
    private final ReportCommentCache cache;
    private RestClient rest; // 지연 생성 (openai 설정이 없을 수도 있어 생성자에서 참조하지 않는다)

    public ReportInsightService(AiProperties properties, ObjectMapper objectMapper,
                                ReportCommentCache cache) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.cache = cache;
    }

    private RestClient rest() {
        if (rest == null) {
            // 짧은 코멘트 한 문장 — 오래 걸리면 리포트 화면이 그만큼 늦어진다.
            rest = RestClient.builder()
                    .requestFactory(ExternalHttpClients.factory(Duration.ofSeconds(15)))
                    .baseUrl(properties.openai().baseUrl())
                    .defaultHeader("Authorization", "Bearer " + properties.openai().apiKey())
                    .build();
        }
        return rest;
    }

    /**
     * 채점 데이터가 있을 때의 코멘트. 여긴 <b>선생님 화면</b>(학생별 학습 현황)이므로
     * '학생에게 하는 응원'이 아니라 '선생님에게' 이 학생을 어떻게 지도하면 좋을지 돕는 분석 톤으로 준다.
     */
    public String comment(List<String> strengths, List<String> weaknesses) {
        String fallback = template(strengths, weaknesses);
        if (!useGms()) {
            return fallback;
        }
        String system = """
                당신은 초등학교 담임 선생님을 돕는 조교입니다. 학생 상세(학습 현황) 화면에 붙일,
                '선생님에게' 드리는 짧은 분석 코멘트를 씁니다.
                - 학생에게 하는 응원·칭찬이 아니라, 선생님이 이 학생을 어떻게 지도하면 좋을지 돕는 분석 톤입니다.
                - 2~3문장: 이 학생이 잘 이해하고 있는 개념과 더 챙겨줘야 할 개념을 짚고,
                  지도할 때 무엇에 집중하면 좋을지 제안합니다.
                - 점수·정답률 같은 숫자는 절대 쓰지 않습니다. 오직 문장만 출력합니다(따옴표·JSON 금지).
                """;
        String user = "잘 이해한 개념: " + (strengths.isEmpty() ? "없음" : String.join(", ", strengths))
                + "\n더 챙길 개념: " + (weaknesses.isEmpty() ? "없음" : String.join(", ", weaknesses));
        // 캐시 미스일 때만 GMS 로 나간다 (왕복 1~2초). 실패하면 null 이 와서 캐시되지 않는다.
        String generated = cache.get(strengths, weaknesses, () -> chat(system, user));
        return generated != null ? generated : fallback;
    }

    /**
     * 채점 데이터가 없을 때의 문구. 여긴 <b>선생님 화면</b>이므로 '학생 응원'이 아니라
     * '선생님에게 도움되는 안내'를 준다 — 지금은 분석할 데이터가 없다는 점 + 과제를 내주면 무엇을 볼 수 있는지.
     */
    public String noDataAdvice() {
        String fallback = "아직 이 학생의 채점된 과제가 없어 분석할 데이터가 없어요. "
                + "진단용 과제를 하나 내주시면 개념별 강·약점과 실력에 맞는 난이도를 여기서 확인할 수 있어요.";
        if (!useGms()) {
            return fallback;
        }
        String system = """
                당신은 초등학교 담임 선생님을 돕는 조교입니다. 학생 상세 화면에 붙일 짧은 안내를 씁니다.
                - 이 학생은 아직 제출·채점된 과제가 없어 분석할 데이터가 없습니다.
                - 학생에게 하는 응원이 아니라, '선생님에게' 도움이 되는 안내 톤으로 씁니다.
                - 2~3문장: 지금은 분석할 데이터가 없다는 점, 그리고 과제를 내주면 무엇(개념별 강·약점,
                  실력 맞춤 난이도)을 볼 수 있는지 제안. 숫자·따옴표·JSON 금지, 문장만 출력.
                """;
        String generated = cache.getNoData(
                () -> chat(system, "분석할 채점 데이터가 없는 상태입니다."));
        return generated != null ? generated : fallback;
    }

    /**
     * 생활통지표의 한 과목 평가란 문장. 여긴 <b>학부모가 읽는 통지표</b>라 '지도 분석'이 아니라
     * 이 학생이 그 과목에서 무엇을 잘하고 무엇을 더 하면 좋을지 담은 서술형 1~2문장이다.
     * 데이터가 있을 때만 호출한다(호출자가 판단). GMS 없거나 실패하면 템플릿.
     */
    public String reportCardComment(String subjectLabel, List<String> strengths,
                                    List<String> weaknesses) {
        String fallback = reportCardTemplate(subjectLabel, strengths, weaknesses);
        if (!useGms()) {
            return fallback;
        }
        String system = """
                당신은 초등학교 담임 선생님입니다. 생활통지표의 한 과목 평가란에 들어갈 문장을 씁니다.
                - 학부모가 읽는 통지표 문장입니다. 이 학생이 이 과목에서 무엇을 잘하는지,
                  무엇을 더 노력하면 좋을지를 따뜻하고 구체적으로 1~2문장으로 서술합니다.
                - 점수·정답률 같은 숫자는 쓰지 않습니다. 오직 문장만 출력합니다(따옴표·JSON 금지).
                """;
        String user = "과목: " + subjectLabel
                + "\n잘하는 점(개념): " + (strengths.isEmpty() ? "없음" : String.join(", ", strengths))
                + "\n더 노력할 점(개념): " + (weaknesses.isEmpty() ? "없음" : String.join(", ", weaknesses));
        String generated = chat(system, user);
        return generated != null ? generated : fallback;
    }

    private String reportCardTemplate(String subjectLabel, List<String> strengths,
                                      List<String> weaknesses) {
        StringBuilder sb = new StringBuilder();
        if (!strengths.isEmpty()) {
            sb.append(String.join(", ", strengths)).append(" 개념을 잘 이해하고 있습니다. ");
        }
        if (!weaknesses.isEmpty()) {
            sb.append(String.join(", ", weaknesses)).append(" 개념은 조금 더 연습하면 좋겠습니다.");
        } else {
            sb.append(subjectLabel).append(" 학습에 성실히 참여하고 있습니다.");
        }
        return sb.toString().strip();
    }

    private boolean useGms() {
        AiProperties.OpenAi o = properties.openai();
        return "openai".equalsIgnoreCase(properties.provider())
                && o != null && o.apiKey() != null && !o.apiKey().isBlank();
    }

    /**
     * GMS 채팅 1회 호출 — 실패·빈 응답이면 <b>null</b>. 폴백 선택을 호출자에게 넘기는 이유는
     * 캐시가 "생성 실패"와 "생성된 문장"을 구분해야 하기 때문이다(실패는 캐시하면 안 된다).
     */
    /**
     * 통지표 한 과목의 **영역별 평가요소**를 뽑는다.
     *
     * <p>실제 초등 통지표의 '평가요소' 칸은 <b>학생을 평가하는 문장이 아니라 교육과정 성취기준
     * 문구</b>다. "직사각형과 정사각형을 분류하고, 성질을 찾아 예를 들어 설명하기" 처럼
     * <b>-하기</b> 로 끝나는 명사구이고, 학생을 지칭하지도 칭찬하지도 않는다. 잘했는지 못했는지는
     * 옆 칸의 '평가'(매우잘함/잘함/…)가 말한다.</p>
     *
     * <p>그래서 이 호출은 <b>문장을 쓰지 않는다.</b> 아이가 실제로 다룬 개념을 영역으로 묶어
     * 성취기준 문구로 바꿔 줄 뿐이다. 등급은 여기서 정하지 않는다 — 정답률이라는 사실이 이미
     * 있으므로 서버가 계산한다(모델에게 성적을 지어내게 하면 안 된다).</p>
     *
     * @return 영역별 항목. 호출/파싱 실패면 빈 목록 — 그때는 선생님이 직접 쓴다.
     */
    public List<ReportCardItem> reportCardItems(String subjectLabel, Integer grade,
                                                List<TagStat> stats) {
        if (!useGms() || stats == null || stats.isEmpty()) {
            return List.of();
        }
        List<String> concepts = stats.stream().map(TagStat::tag).toList();
        String system = """
                당신은 초등학교 생활통지표의 '평가요소' 칸을 채우는 도구입니다.
                교육과정 성취기준 문구만 출력합니다. 그 외의 일은 하지 않습니다.

                [평가요소 칸이 무엇인가 — 가장 중요]
                - 평가요소는 **학생에 대한 평가나 감상이 아닙니다.** 그 학기에 무엇을 배우고
                  무엇을 할 수 있어야 하는지를 적은 **성취기준 문구**입니다.
                - 반드시 **'-하기'로 끝나는 명사구**로 씁니다.
                  예: 설명하기 / 쓰기 / 발표하기 / 표현하기 / 비교하기 / 만들기 / 실천하기
                - 학생을 가리키는 말을 쓰지 않습니다: "이 학생은", "우리 아이는", "학생이" 금지.
                - 평가·칭찬·조언을 쓰지 않습니다: "잘합니다", "훌륭합니다", "노력이 필요합니다",
                  "더 연습하면 좋겠습니다" 모두 금지. 잘하고 못하고는 다른 칸이 말합니다.
                - 문장을 끝맺는 어미(-입니다, -합니다, -해요)를 쓰지 않습니다.
                - 숫자·정답률·점수를 쓰지 않습니다.

                [좋은 예 — 이 결과 그대로 따라 하세요]
                  "알파벳 대문자와 소문자를 구별하여 쓰기"
                  "용수철저울을 사용하여 물체의 무게 비교하기"
                  "직사각형과 정사각형을 분류하고, 성질을 찾아 예를 들어 설명하기"
                  "실생활 상황을 이용하여 나눗셈과 관련된 문제를 만들어 해결하고, 나눗셈의 의미를 설명하기"
                  "중심 문장과 뒷받침 문장을 갖추어 문단을 쓰는 방법을 알고, 소개하는 글쓰기"

                [나쁜 예 — 절대 이렇게 쓰지 마세요]
                  "받침 규칙을 잘 이해하고 있습니다"            (평가 문장이다)
                  "이 학생은 나눗셈을 어려워합니다"              (학생을 지칭하고 평가한다)
                  "나눗셈을 더 연습하면 좋겠습니다"              (조언이다)
                  "나눗셈"                                       (명사구가 아니라 낱말이다)
                  "나눗셈을 이해함"                              (-하기로 끝나지 않는다)

                [분량]
                - 항목은 **2개에서 3개**. 아이가 다룬 개념을 영역으로 묶습니다.
                - 각 평가요소는 **15자 이상 60자 이하**.

                [묶는 기준 — 성취 수준이 비슷한 것끼리]
                - 각 개념 뒤에 '상/중/하' 로 성취 수준이 붙어 있습니다.
                - **수준이 다른 개념을 한 항목에 섞지 마세요.** 특히 '하' 인 개념을 '상' 인 개념과
                  묶으면, 옆 칸의 평가 등급이 평균에 묻혀 **약한 부분이 통지표에서 사라집니다.**
                - '하' 인 개념은 되도록 **자기 항목으로 따로** 묶습니다. 학부모가 무엇을 도와야
                  하는지 알 수 있어야 합니다.
                - 다만 영역이 다르면 수준이 같아도 합치지 않습니다 — 영역이 먼저입니다.

                [영역(area)]
                - 아래 목록에서만 고릅니다. 목록에 없는 영역명을 만들지 않습니다.
                  국어: 듣기·말하기, 읽기, 쓰기, 문법, 문학
                  수학: 수와 연산, 도형과 측정, 변화와 관계, 자료와 가능성
                  사회: 지리 인식, 역사 일반, 자연환경과 인간생활, 사회·경제
                  과학: 운동과 에너지, 물질, 생명, 지구와 우주
                  영어: 이해, 표현

                [출력] — 오직 하나의 JSON 객체만. 설명·인사말·코드펜스 금지.
                {"items":[{"area":"영역명","evalElement":"…하기","concepts":["쓰인 개념", …]}]}
                - concepts 에는 그 항목이 다루는 개념을 **주어진 목록에서 그대로** 골라 적습니다.
                  목록에 없는 개념을 만들지 않습니다. 등급 계산에 쓰이므로 반드시 채웁니다.
                """;
        /*
          성취 수준을 상/중/하로만 준다. 정답률(숫자)을 그대로 주면 모델이 평가요소에 숫자를
          섞어 쓰려 한다 — 통지표 문구에 숫자가 들어가면 안 된다. 등급 계산은 어차피 서버가
          원본 정답률로 하므로, 모델에게는 '묶을 때 쓸 대략의 수준'만 있으면 된다.
        */
        StringBuilder listing = new StringBuilder();
        for (TagStat s : stats) {
            String level = s.accuracy() >= 80 ? "상" : s.accuracy() >= 60 ? "중" : "하";
            listing.append("\n  - ").append(s.tag()).append(" (").append(level).append(")");
        }
        String user = "과목: " + subjectLabel
                + "\n학년: " + (grade != null ? grade + "학년" : "초등")
                + "\n아이가 다룬 개념(뒤는 성취 수준):" + listing;

        String text = chat(system, user, 700);
        if (text == null) {
            return List.of();
        }
        try {
            var root = objectMapper.readTree(stripFences(text));
            List<ReportCardItem> items = new java.util.ArrayList<>();
            for (var node : root.path("items")) {
                String area = node.path("area").asString("").strip();
                String element = node.path("evalElement").asString("").strip();
                if (element.isEmpty()) {
                    continue;
                }
                List<String> used = new java.util.ArrayList<>();
                for (var c : node.path("concepts")) {
                    String tag = c.asString("").strip();
                    // 모델이 지어낸 개념은 버린다 — 등급 계산의 근거가 되므로 실제 것만 쓴다
                    if (concepts.contains(tag)) {
                        used.add(tag);
                    }
                }
                items.add(new ReportCardItem(area, element, used));
            }
            return items;
        } catch (Exception e) {
            log.warn("통지표 평가요소 파싱 실패 — 선생님이 직접 작성한다", e);
            return List.of();
        }
    }

    /** 통지표 한 줄 — 영역 · 평가요소 · 그 항목이 다루는 개념(등급 계산용) */
    public record ReportCardItem(String area, String evalElement, List<String> concepts) {
    }

    /** 모델이 ```json 코드펜스를 붙이는 경우가 있어 JSON 객체만 남긴다 */
    private String stripFences(String text) {
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        return start >= 0 && end > start ? text.substring(start, end + 1) : text;
    }

    private String chat(String system, String user) {
        return chat(system, user, 300);
    }

    private String chat(String system, String user, int maxTokens) {
        try {
            Map<String, Object> body = Map.of(
                    "model", properties.openai().model(),
                    "max_completion_tokens", maxTokens,
                    "messages", List.of(
                            Map.of("role", "system", "content", system),
                            Map.of("role", "user", "content", user)));
            String raw = rest().post()
                    .uri(properties.openai().chatPath())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(String.class);
            String text = objectMapper.readTree(raw)
                    .path("choices").path(0).path("message").path("content")
                    .asString("").strip();
            return text.isEmpty() ? null : text;
        } catch (Exception e) {
            log.warn("리포트 코멘트 LLM 호출 실패 — 폴백 문구 사용", e);
            return null;
        }
    }

    // 폴백도 선생님 화면용 — 학생 응원이 아니라 지도에 참고할 분석 톤으로 준다.
    private String template(List<String> strengths, List<String> weaknesses) {
        StringBuilder sb = new StringBuilder();
        if (!strengths.isEmpty()) {
            sb.append(String.join(", ", strengths)).append(" 개념은 잘 이해하고 있어요. ");
        }
        if (!weaknesses.isEmpty()) {
            sb.append(String.join(", ", weaknesses))
                    .append(" 개념은 아직 약하니, 이 부분을 짚어주는 문제로 지도해 주시면 좋겠어요. "
                            + "아래 추가 문제를 활용해 보세요.");
        } else {
            sb.append("전반적으로 개념을 고르게 이해하고 있어, 한 단계 높은 난이도로 이끌어 주셔도 좋겠어요.");
        }
        return sb.toString();
    }
}
