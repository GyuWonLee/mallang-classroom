package com.mallang.tutor.service;

import com.mallang.material.repository.MaterialRepository;
import com.mallang.material.repository.MaterialTextView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 말랑이 답변에 붙일 '참고 자료' 조립 — 선생님이 그 학급에 올린 학습자료 중 질문과 관련된 문단만 고른다.
 *
 * <p>벡터 검색 인프라가 없어 임베딩 대신 <b>키워드 겹침</b>으로 고른다: 질문에서 뽑은 낱말이
 * 문단에 많이 나올수록 관련이 높다고 본다. 저학년 질문("받침이 뭐예요?")은 핵심 낱말이 그대로
 * 자료에 등장하는 경우가 많아 이 단순한 방식으로도 대체로 맞는 문단을 집어낸다.</p>
 *
 * <p>토큰이 곧 비용이라 문단 수와 총 길이에 상한을 둔다 — 관련 없으면 아무것도 붙이지 않는다
 * (붙일 게 없으면 {@code null}). LLM 은 자료가 없으면 일반 지식으로 답하고, 있으면 그 내용을 바탕으로 답한다.</p>
 */
@Component
@RequiredArgsConstructor
public class TutorMaterialGrounding {

    /** 붙일 문단 최대 개수 — 너무 많으면 질문과 상관없는 내용까지 섞여 답이 흐려진다. */
    private static final int MAX_PARAGRAPHS = 3;
    /** 참고 자료 전체 길이 상한(문자). 토큰 비용 상한의 일부다. */
    private static final int MAX_TOTAL_CHARS = 1200;
    /** 문단 하나가 지나치게 길면 앞부분만 — 한 문단이 예산을 다 먹지 않게. */
    private static final int MAX_PARAGRAPH_CHARS = 500;
    /** 한 글자 토큰은 조사·어미 파편이라 노이즈다 — 두 글자 이상만 키워드로 본다. */
    private static final int MIN_KEYWORD_LENGTH = 2;
    /**
     * 한 번의 질문에 훑을 본문 총량 상한(문자).
     *
     * <p>{@code extracted_text} 는 상한 없는 {@code text} 컬럼이라 PDF 한 권이면 수십만 자가
     * 들어간다. 학급 자료가 쌓이면 질문 한 번이 그 전부를 힙에 올리고 정규식으로 훑는데,
     * 여기서 실제로 쓰이는 건 문단 세 개(1200자)뿐이다. 최신순 앞에서부터 이 예산만큼만 본다.
     */
    private static final int MAX_SCAN_CHARS = 200_000;

    /**
     * 질문에 흔히 붙지만 자료 검색엔 도움 안 되는 낱말 — 키워드에서 뺀다.
     *
     * <p><b>지시대명사가 특히 위험하다.</b> "그거 다시 설명해줘" 같은 후속 질문에서 '그거'가
     * 키워드가 되면, 자료에 우연히 '그거'가 들어간 엉뚱한 문단이 근거로 붙는다. 지시대명사가
     * 무엇을 가리키는지는 이제 대화 문맥이 말해 주므로(최근 3턱), 여기서는 검색어에서 뺀다.</p>
     *
     * <p><b>의문형 어미가 통째로 한 낱말이 되는 것을 놓치고 있었다.</b> 목록에 "예요"·"뭐야"는
     * 있었지만 정작 아이가 가장 많이 쓰는 <b>"뭐예요"</b>가 없었다. 토큰은 공백으로 끊기므로
     * "받침이 뭐예요?"는 낱말이 <b>둘</b>({@code 받침}, {@code 뭐예요})로 세어졌고, 자료에
     * "뭐예요"가 있을 리 없으니 최대 점수가 1이 된다. 즉 <b>가장 흔한 질문 형태가 자료를
     * 눈앞에 두고도 근거를 못 얻었다.</b> 어미는 주제를 담지 않으니 넉넉히 걷어낸다 —
     * 질문이 어미뿐이면 키워드가 없어 근거를 안 붙이는데, 그게 맞는 결과다.</p>
     */
    private static final Set<String> STOPWORDS = Set.of(
            "무엇", "뭐야", "뭔가", "어떻게", "그리고", "그러면", "그런데", "이게", "저게", "그게",
            "여기", "거기", "알려", "알려줘", "가르쳐", "가르쳐줘", "해줘", "인가요", "예요", "일까",
            "왜요", "무슨", "어떤", "얼마", "언제", "어디",
            "그거", "이거", "저거", "그건", "이건", "저건", "다시", "설명", "설명해", "말해",
            "궁금", "질문", "부탁", "한번", "좀더", "다른",
            // 의문형 어미 — 자료 본문에는 없고 질문에만 붙는다
            "뭐예요", "뭐에요", "뭔가요", "뭐지", "뭐죠", "뭔데", "뭘까", "뭘까요", "뭡니까",
            "어때", "어때요", "하나요", "있나요", "없나요", "되나요", "할까요", "해요", "있어요",
            "주세요", "알려주세요", "가르쳐주세요", "모르겠어", "모르겠어요");

    /**
     * 낱말 끝에서 떼어 낼 조사·어미.
     *
     * <p>예전에는 <b>세 글자 이상이면 끝 한 글자를 무조건</b> 떼어 어간 후보로 삼았다. 그러면
     * "나눗셈"이 "나눗세"가 되어 아무 자료에도 안 걸리고, 반대로 "받침은"처럼 두 글자 조사가
     * 붙으면 "받침으"가 되어 역시 못 찾는다. 실제 조사 목록으로 떼는 편이 정확하다.</p>
     *
     * <p>긴 것부터 본다 — "에게"를 "에"로 먼저 떼면 "게"가 남는다.</p>
     */
    private static final List<String> PARTICLES = List.of(
            "이랑", "에서", "에게", "한테", "부터", "까지", "보다", "처럼", "하고", "라고", "으로",
            "은", "는", "이", "가", "을", "를", "과", "와", "도", "만", "의", "로");

    /**
     * 근거로 쓸 최소 겹침 낱말 수 — <b>질문이 가진 낱말 수에 맞춘다.</b>
     *
     * <p>기본은 2다. 1점이면 흔한 낱말 하나가 우연히 겹친 것일 수 있는데, 그런 문단을 "질문과
     * 관련된 자료"라고 붙이면 모델이 엉뚱한 내용을 근거 삼아 답한다. 아무것도 안 붙이는 편이
     * 낫다(그때는 일반 지식으로 답한다).</p>
     *
     * <p><b>다만 질문에 낱말이 하나뿐이면 2를 요구할 수 없다.</b> "받침이 뭐예요?" 처럼 아이가
     * 가장 흔하게 묻는 짧은 형태가 바로 여기다 — 조사와 불용어를 걷어내면 남는 낱말이 '받침'
     * 하나다. 고정 2점이면 이런 질문은 <b>자료가 멀쩡히 있어도 영원히 근거를 못 얻는다.</b>
     * 뽑을 수 있는 최대치가 1점인 질문에서 1점은 '우연히 하나 겹침'이 아니라 '가진 낱말이
     * 전부 겹침'이다.</p>
     */
    private static int minScore(List<List<String>> keywords) {
        return Math.min(2, keywords.size());
    }

    private final MaterialRepository materialRepository;

    /**
     * 질문과 관련된 학급 자료 문단들, 없으면 null.
     *
     * <p><b>READY 자료만 본다.</b> 예전에는 본문이 있기만 하면 무엇이든 근거로 썼는데, 그러면
     * 선생님이 아직 확인하지 않은 PREVIEW 자료의 문장이 아이 답변에 그대로 인용된다. 상태
     * 머신이 PREVIEW 단계를 두는 이유가 "손글씨·저화질 스캔은 추출이 깨질 수 있으니 눈으로
     * 확인한 뒤에만 쓴다"인데, 정작 이 경로가 그 관문을 지나쳤다. {@code TutorActionExecutor}
     * 는 같은 자료를 <b>열어 주지는</b> 않으면서(READY 필터가 있다) 여기서는 <b>인용</b>되던
     * 셈이라, 두 경로의 기준을 맞춘다.
     */
    @Transactional(readOnly = true)
    public String contextFor(Long classroomId, String question) {
        List<List<String>> keywords = keywords(question);
        if (keywords.isEmpty()) {
            return null;
        }
        int minScore = minScore(keywords);
        List<Scored> scored = new ArrayList<>();
        int scanned = 0;
        for (MaterialTextView material : materialRepository.findReadyTexts(classroomId)) {
            String text = material.extractedText();
            if (text == null || text.isBlank()) {
                continue;
            }
            if (scanned >= MAX_SCAN_CHARS) {
                break;
            }
            scanned += text.length();
            for (String paragraph : paragraphs(text)) {
                int score = overlap(paragraph, keywords);
                // 낱말이 여럿인 질문은 2점부터 — 1점은 흔한 낱말이 우연히 겹친 것일 수 있다
                if (score >= minScore) {
                    scored.add(new Scored(material.title(), paragraph.strip(), score));
                }
            }
        }
        if (scored.isEmpty()) {
            return null;
        }
        // 관련도 높은 순 — 같으면 짧은 문단을 먼저(핵심만 든 문단일 확률이 높다).
        scored.sort(Comparator.comparingInt((Scored s) -> s.score).reversed()
                .thenComparingInt(s -> s.paragraph.length()));

        StringBuilder sb = new StringBuilder();
        int taken = 0;
        for (Scored s : scored) {
            if (taken >= MAX_PARAGRAPHS) {
                break;
            }
            String body = s.paragraph.length() > MAX_PARAGRAPH_CHARS
                    ? s.paragraph.substring(0, MAX_PARAGRAPH_CHARS) + "…"
                    : s.paragraph;
            /*
              **붙이기 전에 총량을 본다.** 예전에는 `sb.length() >= MAX_TOTAL_CHARS` 를 얹은
              뒤에 검사해서, 마지막 문단이 통째로 들어간 다음에야 멈췄다 — 상한을 한 문단
              (최대 500자)만큼 넘길 수 있었다.
            */
            if (sb.length() + body.length() > MAX_TOTAL_CHARS) {
                break;
            }
            sb.append("- (").append(s.title).append(") ").append(body).append('\n');
            taken++;
        }
        return sb.toString().strip();
    }

    /**
     * 질문에서 뽑은 검색어 — <b>낱말 하나가 리스트 하나</b>다.
     *
     * <p>안쪽 리스트는 같은 낱말의 표기 변형("받침은", "받침")이라 <b>둘 중 하나만 걸려도 1점</b>
     * 이다. 예전에는 원형과 어간을 따로 세어, "받침은"이 든 문단이 두 낱말에 걸려 2점을 받았다 —
     * 한 낱말이 겹쳤을 뿐인데 두 낱말이 겹친 문단과 같은 점수가 됐다.</p>
     */
    private List<List<String>> keywords(String question) {
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<List<String>> groups = new ArrayList<>();
        for (String token : question.toLowerCase().split("[^0-9a-z\\p{IsHangul}]+")) {
            if (token.length() < MIN_KEYWORD_LENGTH || STOPWORDS.contains(token) || !seen.add(token)) {
                continue;
            }
            List<String> variants = new ArrayList<>();
            variants.add(token);
            String stem = stripParticle(token);
            if (stem != null && !STOPWORDS.contains(stem)) {
                variants.add(stem);
            }
            groups.add(variants);
        }
        return groups;
    }

    /** 끝에 붙은 조사를 뗀 어간. 뗄 것이 없거나 너무 짧아지면 null. */
    private String stripParticle(String token) {
        for (String particle : PARTICLES) {
            if (token.length() > particle.length() && token.endsWith(particle)) {
                String stem = token.substring(0, token.length() - particle.length());
                return stem.length() >= MIN_KEYWORD_LENGTH ? stem : null;
            }
        }
        return null;
    }

    /** 문단을 빈 줄 기준으로 나눈다. 빈 줄이 없으면 줄 단위로라도 쪼갠다. */
    private List<String> paragraphs(String text) {
        List<String> out = new ArrayList<>();
        for (String chunk : text.split("\\n\\s*\\n")) {
            if (!chunk.isBlank()) {
                out.add(chunk);
            }
        }
        if (out.size() <= 1) {
            out.clear();
            for (String line : text.split("\\r?\\n")) {
                if (!line.isBlank()) {
                    out.add(line);
                }
            }
        }
        return out;
    }

    /** 문단에 등장하는 '서로 다른' 키워드 수 — 같은 낱말이 여러 번 나와도 1로 센다. */
    /** 겹친 <b>낱말 수</b>. 한 낱말의 표기 변형이 여럿 걸려도 1점이다(keywords 주석 참고). */
    private int overlap(String paragraph, List<List<String>> keywords) {
        String lower = paragraph.toLowerCase();
        int score = 0;
        for (List<String> variants : keywords) {
            for (String variant : variants) {
                if (lower.contains(variant)) {
                    score++;
                    break;
                }
            }
        }
        return score;
    }

    private record Scored(String title, String paragraph, int score) {
    }
}
