package com.mallang.tutor.service;

import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * 말랑이 입력 안전 필터 — 초등학생이 쓰는 챗봇이라 명백한 욕설·비속어는 LLM 에 닿기 전에 막는다.
 *
 * <p>여긴 <b>결정적(키워드) 1차 방어</b>만 한다. LLM 이 꺼져 있어도(키 없음) 동작하고, 크레딧을
 * 쓰지 않으며, 무엇을 걸렀는지 눈으로 확인·테스트할 수 있다. 폭력·성적·자해 같은 <b>뉘앙스가 필요한
 * 주제</b>는 여기서 단어로 막지 않는다 — {@link AiTutorClient} 의 시스템 프롬프트가 문맥을 보고
 * 부드럽게 거절·안내하도록 맡긴다.</p>
 *
 * <p>목록이 둘이다. {@link #blockedMessage} 는 욕설을 <b>막고</b>,
 * {@link #concernSignal} 은 도움이 필요한 신호를 <b>막지 않고 표시만</b> 한다.
 * 둘을 합치면 자해를 말하는 아이를 "그런 말은 쓰지 말자"고 돌려세우게 된다.</p>
 *
 * <p><b>한국어 부분일치의 함정</b> 때문에 목록은 일부러 보수적으로 둔다. "시발"은 '시발점',
 * "새끼"는 '고양이 새끼', "보지"는 '보지 못했다'처럼 멀쩡한 말에 섞여 오탐을 낸다. 그래서 정상 문장에
 * 거의 안 나오는 <b>초성 욕</b>과 <b>충돌 없는 명백한 욕</b>만 담는다. 목록은 운영하며 늘려 간다.</p>
 */
@Component
public class TutorSafetyFilter {

    /** 막혔을 때 학생에게 돌려주는 말 — 혼내기보다 바른 말로 다시 물어보도록 다정하게 돌려세운다. */
    static final String REDIRECT =
            "앗, 그런 말은 말랑이랑 함께 쓰지 않기로 해요. 궁금한 공부가 있으면 언제든 다시 물어봐 줘!";

    /**
     * 차단 목록. 정상 문장에 거의 섞이지 않는 것만 — '시발/새끼/보지/자지/걸레/씹' 같은 오탐어는 뺐다.
     * (필요하면 운영하며 추가하되, 멀쩡한 낱말의 부분문자열이 되지 않는지 반드시 확인한다.)
     */
    private static final List<String> BANNED = List.of(
            // 초성 욕 — 정상 텍스트엔 거의 안 나온다
            "ㅅㅂ", "ㅆㅂ", "ㅂㅅ", "ㅄ", "ㅈㄹ", "ㄷㅊ", "ㅗㅗ",
            // 명백한 욕설 (충돌 낮은 형태만)
            "씨발", "씨빨", "씨팔", "쌍놈", "쌍년", "썅년", "썅놈", "병신", "지랄",
            "좆", "존나", "존만", "개새끼", "개색기", "개세끼", "니미", "닥쳐", "꺼져",
            "엿먹", "미친놈", "미친년", "후레자식",
            /*
              뺀 것들과 그 이유:
              - "꺼져"  : "촛불이 왜 꺼져요?", "불이 꺼져서" 처럼 멀쩡한 질문에 흔히 나온다.
                          공부 질문을 욕설로 막으면 아이가 다시 묻지 않는다.
              - "creep" : 영어 질문에 그대로 나올 수 있고(동사 '기어가다'), 초등 욕설로 드물다.
              한국어 부분일치는 오탐이 비싸다 — 막는 목록은 좁게 둔다.
            */
            // 영어 비속어
            "fuck", "shit", "bitch", "asshole", "dick");

    /**
     * <b>차단과 완전히 다른 목적의 두 번째 목록</b> — 아이가 도움을 필요로 한다는 신호.
     *
     * <p>여기 걸려도 답변은 정상적으로 나간다. 아이 경험은 하나도 바뀌지 않는다.
     * 바뀌는 것은 선생님 쪽뿐이다 — "살펴봐야 할 대화"로 표시된다.
     *
     * <p>왜 필요한가: {@link AiTutorClient} 의 시스템 프롬프트는 아이에게 "믿을 수 있는 어른과
     * 나눠 줘"라고 말한다. 그런데 <b>어른에게 알리는 경로가 저장소에 없었다.</b> 복식학급은
     * 교사 한 명이 여러 학년을 동시에 보고, 담임이 20명의 말랑이 대화를 매일 훑어보는 것은
     * 비현실적이다. 아이가 털어놓은 말이 아무도 읽지 않는 표에 쌓이기만 했다.
     *
     * <p><b>차단 목록과 절대 합치지 않는다.</b> 자해·폭력 피해·괴롭힘을 말하는 아이를
     * "그런 말은 쓰지 말자"고 돌려세우면, 겨우 꺼낸 말을 막는 셈이 된다.
     *
     * <p>오탐은 싸고 미탐은 비싸다 — 선생님이 한 번 눈으로 보면 끝나는 일이다. 그래도
     * 표시가 너무 흔하면 아무도 안 보게 되므로, 정상 대화에 잘 섞이지 않는 <b>여러 글자
     * 구절</b>만 담는다. 목록은 운영하며 늘려 간다.
     */
    private static final List<Signal> CONCERN_SIGNALS = List.of(
            new Signal("자해·자살 신호", List.of(
                    "죽고싶", "죽고파", "죽어버리", "죽는게나", "자살", "자해",
                    "사라지고싶", "없어지고싶", "살기싫", "살고싶지않", "태어나지말")),
            new Signal("폭력 피해 신호", List.of(
                    "나를때", "저를때", "때려서아파", "맞아서아파", "맞는게무서",
                    "때리는게무서", "학교폭력", "학대",
                    /*
                      **누가 때리는지**로 잡는다. 예전 목록은 "나를때"처럼 목적어가 앞에 오는
                      말투만 담아, "아빠가 때려요" "형이 때려" 같은 가장 흔한 문장을 놓쳤다.
                      아이는 보통 주어를 먼저 말한다.
                    */
                    "아빠가때", "엄마가때", "형이때", "누나가때", "언니가때", "오빠가때",
                    "친구가때", "선생님이때", "애들이때", "때려요", "때렸어", "맞았어")),
            new Signal("괴롭힘 신호", List.of(
                    "왕따", "따돌림", "따돌려", "괴롭혀", "괴롭힘", "놀림받",
                    "아무도안놀아", "혼자밥먹")));

    private record Signal(String reason, List<String> phrases) {
    }

    /**
     * 살펴봐야 할 대화인지 — 걸리면 사유, 아니면 비어 있음.
     *
     * <p>{@link #blockedMessage} 와 달리 <b>아무것도 막지 않는다.</b> 호출부는 답변을 그대로
     * 내보내고 기록에만 표시를 남긴다.
     */
    public Optional<String> concernSignal(String question) {
        String normalized = normalize(question);
        for (Signal signal : CONCERN_SIGNALS) {
            for (String phrase : signal.phrases()) {
                if (normalized.contains(phrase)) {
                    return Optional.of(signal.reason());
                }
            }
        }
        return Optional.empty();
    }

    /** 막아야 하면 학생에게 보여줄 안내 문구, 괜찮으면 비어 있음. */
    public Optional<String> blockedMessage(String question) {
        String normalized = normalize(question);
        for (String banned : BANNED) {
            if (normalized.contains(banned)) {
                return Optional.of(REDIRECT);
            }
        }
        return Optional.empty();
    }

    /** 띄어쓰기·구두점으로 욕을 흩뜨리는 회피("ㅅ ㅂ", "씨.발")를 잡으려 공백·구분기호를 지운다. */
    private String normalize(String question) {
        return question.toLowerCase().replaceAll("[\\s.,_\\-*~^!?]+", "");
    }
}
