import type { AssignmentProblem, AssignmentType } from '@/types/assignment'
import type { QuizQuestion } from '@/types/classroom'

/**
 * 퀴즈 화면이 실제로 푸는 한 문항.
 *
 * `no` 는 **서버 원본 문항 번호**다. 제출(`answers`)의 키는 화면 인덱스가 아니라 이 값이어야
 * 백엔드 채점기(`GradingService` 가 `answers.path(String.valueOf(no))` 로 조회)가 답을 찾는다.
 * 선택지가 없어 걸러낸 문항이 있으면 화면 인덱스는 서버 번호와 어긋나므로 반드시 여기서 들고 다닌다.
 */
export interface QuizItem extends QuizQuestion {
  no: number
  /**
   * 화면이 그리는 모양.
   *  - `choice`    : 보기 목록 (객관식·조사 고르기)
   *  - `ox`        : O / X 두 개 (백엔드 규칙: `choices=["O","X"]`, `answer` 0=O·1=X)
   *  - `dictation` : 듣고 받아쓰기
   *
   * 정답 판정은 `ox` 도 `choice` 와 같다(인덱스 비교) — 다른 건 보이는 모양뿐이다.
   */
  kind: 'choice' | 'ox' | 'dictation'
  /** 받아쓰기 정답 문장 (선택형은 null) */
  answerText: string | null
  /**
   * TTS 로 읽어 줄 문장.
   *  - 받아쓰기 : 받아쓸 문장 (화면에는 없고 소리로만 준다)
   *  - 선택형   : **발문 + 보기 전체** (가·나·다·라 라벨 포함)
   *  - OX       : 발문만
   */
  speakText: string
}

/**
 * 이 문항이 OX 인가 — 백엔드가 OX 를 `choices: ["O","X"]` 로 만든다(GenerationPrompt).
 *
 * QUIZ_GAME 은 별도 문항 스키마가 없는 **표시 모드**라(AssignmentType 주석) 문항마다
 * OX 인지 객관식인지 보기 내용으로 판별해야 한다.
 */
function isOxChoices(choices: string[] | null): boolean {
  if (!choices || choices.length !== 2) return false
  const [a, b] = choices.map((c) => c.trim().toUpperCase())
  return (a === 'O' && b === 'X') || (a === 'X' && b === 'O')
}

/**
 * 받아쓰기 비교용 정규화 — 백엔드 `GradingService.normalize` 와 **같은 규칙**이어야
 * 화면의 즉시 피드백과 서버 채점이 어긋나지 않는다 (공백·문장부호 제거 + 소문자).
 */
export function normalizeDictation(text: string): string {
  return text.replace(/[\s.,!?…"'`~·]/g, '').toLowerCase()
}

function hintOf(p: AssignmentProblem, fallback: string): string {
  return p.conceptTags?.length ? `${p.conceptTags.join(', ')}을 떠올려 봐요` : fallback
}

const ANSWER_KEYS = ['가', '나', '다', '라', '마', '바', '사', '아']

/**
 * 보기 번호표. **화면과 TTS 가 같은 말을 쓰기 위해 여기 한 곳에 둔다** —
 * 예전엔 QuizView 안에만 있어서, 읽어주는 문장에 번호를 붙이려면 규칙을 베껴 써야 했다.
 * 화면은 "가" 라고 적어 놓고 소리는 "1번" 이라고 읽으면 아직 글을 못 읽는 아이가 짝을 못 맞춘다.
 *
 * 표를 넘어가면 숫자로 떨어뜨린다 (예전엔 5번째 보기에서 `undefined` 가 그려졌다).
 */
export function answerKey(i: number): string {
  return ANSWER_KEYS[i] ?? String(i + 1)
}

/**
 * 읽어 줄 문장 — **발문 다음에 보기까지** 이어 붙인다.
 *
 * 아직 더듬더듬 읽는 저학년이 소리만으로 문제를 풀 수 있어야 한다. 발문만 읽어 주면
 * "무엇을 묻는지" 는 알아도 **고를 것이 무엇인지는 모른다**.
 *
 * 라벨은 화면과 같은 `answerKey`(가·나·다·라)를 쓴다. 줄바꿈으로 이어 붙이는 이유는
 * TTS 가 문장 경계에서 쉬어 주기 때문이다 — 보기가 한 덩어리로 붙어 나오면 구분이 안 된다.
 */
function speakTextOf(prompt: string, choices: string[]): string {
  if (choices.length === 0) return prompt
  return [prompt, ...choices.map((c, i) => `${answerKey(i)}. ${c}`)].join('\n')
}

/**
 * 서버 과제 문항 -> 학생 퀴즈 화면 모델.
 *
 * 백엔드 문항은 발문이 `prompt`, 선택형 정답이 `answer`(인덱스), 받아쓰기 정답이 `answerText` 다.
 * **채점 방식은 문항이 아니라 과제 `type` 이 정한다**(`GradingService.judge`) — DICTATION 과제는
 * 전 문항을 받아쓰기로, 나머지는 전 문항을 선택형으로 본다. 화면도 같은 기준으로 나눈다.
 */
export function toQuizQuestions(
  problems: AssignmentProblem[],
  type: AssignmentType,
): QuizItem[] {
  /** 받아쓰기 화면 발문 — 서버 prompt 에는 정답 문장이 들어 있어 쓰지 않는다 (아래 참고) */
  const DICTATION_PROMPT = '다음 문장을 듣고 받아쓰세요.'

  if (type === 'DICTATION') {
    return problems
      .filter((p) => Boolean(p.answerText?.trim()))
      .map((p) => ({
        no: p.no,
        kind: 'dictation' as const,
        /*
          **받아쓰기 발문은 화면에 그대로 쓰지 않는다.**

          백엔드 생성 지시문(GenerationPrompt)이 받아쓰기의 `prompt` 에 **읽어 줄 문장 자체**를
          넣게 되어 있다. 그대로 렌더하면 받아쓸 문장이 제목처럼 인쇄돼 **정답이 보인다** —
          듣고 쓰는 문제가 보고 베끼는 문제가 된다. (스텁 생성기는 우연히 "다음 문장을 듣고
          받아쓰세요."를 넣어서 이 구멍이 안 보였고, 실제 LLM 으로 돌려야 드러난다.)

          문장은 소리로만 준다 — `speakText` 로 TTS 에 넘어간다.
        */
        text: DICTATION_PROMPT,
        passage: null,
        answers: [],
        // 받아쓰기는 인덱스 정답이 없다 — 로컬 판정은 answerText 로 한다
        correct: -1,
        answerText: p.answerText,
        speakText: (p.answerText ?? p.prompt).trim(),
        hint: hintOf(p, '들은 대로 천천히 써 봐요'),
      }))
  }

  return problems
    .filter((p) => Array.isArray(p.choices) && p.choices.length > 0 && p.answer !== null)
    .map((p) => {
      /*
        OX 과제는 전 문항이 OX 다. QUIZ_GAME 은 표시 모드라 문항별로 섞일 수 있어 보기로 판별한다.
        예전엔 이 구분이 없어서 OX 문항이 "가 / 나" 라벨의 일반 보기로 나왔다 — O·X 를 물어보는데
        답 버튼에 O·X 가 없었다.
      */
      const kind: 'ox' | 'choice' = type === 'OX' || isOxChoices(p.choices) ? 'ox' : 'choice'
      const choices = p.choices as string[]
      return {
      no: p.no,
      kind,
      text: p.prompt,
      /*
        **`sourceRef.quote` 를 학생에게 보여주면 안 된다.** 예전엔 이걸 원고지 지문으로 깔았는데,
        그건 지문이 아니라 **채점·감사용 근거(provenance)** 다. 두 가지 이유로 답이 새어 나갔다:

         1) 인용문은 자료에서 "글자 하나 바꾸지 않고 그대로" 복사된다(GenerationPrompt.java:47).
            근거 자료가 교사용 교재라 정답란이 그대로 딸려 온다 — 실제로 발문 바로 아래에
            "2 정답: ②", "정답: 송알송알, 대롱대롱 …" 이 인쇄됐다.
         2) 글자에 '정답' 이 없어도 마찬가지다. 프롬프트가 **"sourceQuote 에 적은 문장만 읽고도
            풀리는 문항만 만든다"**(같은 파일 49행)고 요구하므로, 인용문은 **설계상** 답을
            넘겨주는 값이다. 문구를 걸러내는 식으로는 막을 수 없다.

        근거 인용은 선생님만 본다 — 과제 생성 검수 화면(AssignmentWizardModal)에서 "근거" 로
        보여주는 것이 맞는 자리다.

        지문 자체가 필요해지면 **백엔드에 학생용 지문 필드가 따로 생겨야 한다**(현재 문항
        스키마에는 없다). 그때까지 여기는 null 이다.
      */
      passage: null,
      answers: choices,
      correct: p.answer as number,
      answerText: null,
      /*
        선택형은 **발문 + 보기**를 읽어 준다 (speakTextOf).

        OX 는 발문만 읽는다 — 화면이 큰 O·X 글리프에 "맞아요 / 틀려요" 를 이미 적어 두고
        보기도 항상 그 둘뿐이라, 매 문항마다 같은 두 단어를 덧붙여 읽으면 소리만 길어진다.
      */
      speakText: kind === 'ox' ? p.prompt : speakTextOf(p.prompt, choices),
      hint: hintOf(p, '천천히 다시 읽어 봐요'),
      }
    })
}
