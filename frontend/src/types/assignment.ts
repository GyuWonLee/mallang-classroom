/**
 * 과제 도메인 타입 — 백엔드 `assignment/dto/AssignmentDtos.java` 실계약 기준 (2026-07-28).
 *
 * 명세(api-spec.md 7장)와 다른 부분은 **실제 구현을 따른다**:
 *  - 생성 요청에 `topic` 없음. 근거 학습자료 `materialIds` 가 필수(@NotEmpty)다.
 *  - 명세의 `personalize` 는 미구현 — 필드 없음.
 *  - 공개 여부는 응답이 `publishedAt`(nullable), 요청이 `publish`(boolean) 로 이름이 다르다.
 */

/**
 * 과목 — 백엔드 `assignment/entity/Subject.java` (S15P11A407-145 로 재정의).
 *
 * 국영수사과 5과목이고 **`HANJA` 는 없어졌다**. 마이그레이션(V24)이 기존 한자 과제를
 * `KOREAN` 으로 옮겼으니 화면이 한자를 만날 일도 없다.
 *
 * 서버는 이 값을 **enum 이름 그대로**(`"KOREAN"`) 내려주고 한글 표기를 실어 주지 않는다
 * (통지표 응답에서 `subjectLabel` 을 뺀 게 그 결정이다 — 72c7bce). 한글은 화면이 붙인다:
 * `lib/subject.ts` 의 `SUBJECT_LABEL` 이 그 유일한 표다.
 */
export type Subject = 'KOREAN' | 'ENGLISH' | 'MATH' | 'SOCIAL' | 'SCIENCE'
/** 백엔드 AssignmentType enum 5종 — OX 포함 */
export type AssignmentType = 'DICTATION' | 'MULTIPLE_CHOICE' | 'PARTICLE_CHOICE' | 'OX' | 'QUIZ_GAME'
export type AssignmentSource = 'MANUAL' | 'AI_GENERATED'

/** 문항 근거 — 검수 화면에서 "자료 원문 대조"에 쓴다 */
export interface ProblemSourceRef {
  materialId: string
  quote: string
}

/**
 * 문항 (JSONB content.problems[]).
 * 선택형은 `choices`+`answer`, 받아쓰기는 `answerText` 가 채워지고 나머지는 null 이다.
 */
export interface AssignmentProblem {
  no: number
  /** 발문 (받아쓰기는 읽어줄 문장) — 백엔드 필드명은 text 가 아니라 prompt */
  prompt: string
  /** 선택형 정답 후보. 받아쓰기는 null */
  choices: string[] | null
  /** 선택형 정답 인덱스. 받아쓰기는 null */
  answer: number | null
  /** 받아쓰기 정답 텍스트. 선택형은 null */
  answerText: string | null
  /** 학년별 고정 태그 사전에서만 선택 (약점 집계의 축) */
  conceptTags: string[] | null
  /** 1~3 난이도 */
  level: number | null
  sourceRef?: ProblemSourceRef | null
  /**
   * 검증 결과 — 이 문항이 **학생이 보는 것만으로 풀리는가** (백엔드 `AssignmentVerifier`).
   *
   * `false` 면 선생님에게 경고를 띄워 지우도록 유도한다. `true` 이거나 **없으면**(undefined)
   * 경고하지 않는다 — 없는 것은 "통과"가 아니라 **검증을 못 했다**는 뜻이다(AI 키가 없거나
   * 판정 호출이 실패하면 서버가 플래그를 아예 붙이지 않는다). 둘 다 조용히 넘기는 게 맞다:
   * 판정 못 한 문항에 경고를 붙이면 매번 전부 빨갛게 뜬다.
   *
   * ⚠ **판정 기준이 우리 학생 화면과 정확히 같지는 않다.** 검증 프롬프트는 "학생은 인용문·
   * 발문·보기를 본다"를 전제하는데, 우리는 인용문(`sourceRef.quote`)을 학생에게 **보여주지
   * 않는다**(교재 정답란이 그대로 들어 있어 뺐다 — lib/quiz.ts). 그래서 `verified: true` 인데도
   * 인용문에 의존하는 문항은 학생에게 풀리지 않을 수 있다. 백엔드와 맞춰야 할 문제다.
   */
  verified?: boolean
  /** `verified === false` 인 이유 (20자 이내 한국어). 경고 옆에 그대로 보여준다 */
  verifyNote?: string | null
  /*
    오디오 필드는 없다. TTS 는 온디맨드(`POST /api/tts`)라 초안 조립기가 문항에 절대 넣지 않는다.
    읽어 줄 문장은 화면이 정한다 — 받아쓰기면 `answerText`, 그 외에는 `prompt` (services/api/ttsApi).
  */
}

export interface AssignmentContent {
  problems: AssignmentProblem[]
}

/** GET 응답 (AssignmentResponse) */
export interface Assignment {
  id: number
  classroomId: number
  title: string
  subject: Subject
  type: AssignmentType
  source: AssignmentSource
  sourceMaterialIds: string[]
  content: AssignmentContent
  dueAt: string | null
  /** 공개 시각. null 이면 미공개 */
  publishedAt: string | null
  createdBy: number
  createdAt: string
  /** `publishedAt != null` 파생값 — UI 편의용 (백엔드 필드 아님) */
  published: boolean
}

/** 목록 응답 (AssignmentSummaryResponse) — content 없음 */
export interface AssignmentSummary {
  id: number
  title: string
  subject: Subject
  /**
   * 표시용 학년 (백엔드 V21). **접근 제어와 무관하다** — 누가 보는지는 `targetGrades`·
   * `targetStudentIds` 가 정한다. 예전 과제는 이 값이 없고 제목에 "3학년 " 이 붙어 있어서,
   * 읽는 쪽은 `grade ?? gradeFromTitle(title)` 순으로 본다 (lib/assignmentGrade).
   */
  grade: number | null
  type: AssignmentType
  source: AssignmentSource
  dueAt: string | null
  publishedAt: string | null
  createdAt: string
  published: boolean
  /** 공개 대상 — 선생님이 부를 때만 채워진다(다른 대상 노출 방지). 둘 다 비면 학급 전체 */
  targetGrades: number[] | null
  targetStudentIds: number[] | null
  /**
   * 내가 냈는지 (S15P11A407-130). **학생이 호출할 때만 채워진다** — 선생님에게는
   * "누구 기준"이 성립하지 않아 `null` 이다. 그래서 `false` 와 `null` 을 구분해야 한다:
   * `false` = 아직 안 냈다, `null` = 알 수 없다(선생님 시점).
   */
  submitted: boolean | null
  /** 내 점수 (백분율 0~100). 미제출이거나 선생님 시점이면 null */
  score: number | null
  /*
    아래 4개는 반대로 **선생님이 부를 때만** 채워진다 (백엔드 S15P11A407-137 §11.2 #7).
    학생에게는 학급 전체 통계가 의미 없어 전부 null 이다. `submitted`/`score` 와
    정확히 배타적이라, 둘 중 어느 쪽이 채워졌는지로 시점을 구분할 수 있다.
  */
  /** 학급 학생 수 */
  totalStudents: number | null
  /** 낸 학생 수 (과제별 최신 시도 기준) */
  submittedCount: number | null
  /** 제출률 0~100. **학생이 없으면 null**(분모가 0) — 0% 와 다르다 */
  submissionRate: number | null
  /** 채점된 제출만의 평균. 채점된 게 없으면 null (0점이 아니다) */
  averageScore: number | null
}

/** POST /classrooms/{id}/assignments — AI 초안을 그대로 넣어 확정 저장할 수 있는 형태 */
export interface CreateAssignmentRequest {
  title: string
  subject: Subject
  type: AssignmentType
  /** 학년 1~6. 표시용이다(대상 판정은 targetGrades 가 한다). 직접 작성이면 생략 가능 */
  grade?: number | null
  /** 생략 시 백엔드 기본값 MANUAL */
  source?: AssignmentSource
  sourceMaterialIds?: string[] | null
  content: AssignmentContent
  dueAt?: string | null
  /** 백엔드 필드명은 published 가 아니라 publish */
  publish?: boolean
  /**
   * 공개 대상 — **둘 다 비면 학급 전체**(하위호환). 서버는 둘을 **합집합**으로 판정한다
   * (`Assignment.isVisibleTo`: 대상 학년에 들거나 대상 학생에 들면 보인다).
   *
   * 목록·열람·제출 세 곳 모두에서 강제된다(안 맞으면 403 `assignment-not-assigned`).
   * 표시용 `grade` 와 헷갈리지 말 것 — 그쪽은 접근 제어에 관여하지 않는다.
   */
  targetGrades?: number[] | null
  targetStudentIds?: number[] | null
}

export interface UpdateAssignmentRequest {
  title?: string
  dueAt?: string | null
  publish?: boolean
  /**
   * 문항 교체 (삭제·추가·수정) — 보내면 `content` 를 통째로 갈아치운다. 안 보내면 그대로 둔다.
   *
   * **미공개 과제만 된다.** 이미 공개된 과제에 보내면 서버가 409 `assignment-content-locked`
   * 로 거절한다(AssignmentService.java:120-124) — 이미 푼 학생의 답안과 어긋나기 때문이다.
   * 그래서 화면에서도 `published` 가 아닐 때만 편집을 노출한다.
   */
  content?: AssignmentContent
}

/**
 * AI 과제 생성 요청 (비동기).
 * `materialIds` 는 @NotEmpty — 현재 백엔드는 내장 어휘 자료 `builtin-korean-g1`~`g6` 만 해석한다
 * (`assignment/material/MaterialSource.java`). 업로드 PDF 연결은 후속 브랜치.
 */
export interface GenerateAssignmentRequest {
  subject: Subject
  /** 1~6 */
  grade: number
  /** 1~30 */
  count: number
  type: AssignmentType
  materialIds: string[]
}

/** 백엔드 JobStatus enum */
export type GenerationStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'

/** 생성 초안 — 검수 후 그대로 CreateAssignmentRequest 로 보낼 수 있다 */
export interface AssignmentDraft {
  title: string
  subject: Subject
  type: AssignmentType
  source: AssignmentSource
  sourceMaterialIds: string[]
  dueAt: string | null
  content: AssignmentContent
  /**
   * 자료를 **그대로 인용하지 못해 '범위'로만 썼다**는 표시.
   *
   * 빈칸 학습지처럼 문장마다 답이 비어 있는 자료는 인용해도 정답이 확정되지 않아, 서버가
   * 자료를 주제·개념 범위로만 쓰고 예문을 새로 지어 만든다. 그러면 문항 옆 인용문이 자료
   * 원문이 아니므로, 검수하는 선생님에게 그 사실을 알려야 한다.
   */
  scopeExpanded?: boolean
}

/** GET /generation-jobs/{jobId} */
export interface GenerationJob {
  jobId: string
  status: GenerationStatus
  /** DONE 일 때만 채워진다 */
  draft?: AssignmentDraft | null
  /** FAILED 일 때 사유 */
  error?: string | null
}

/*
  `builtinMaterialId()` 를 지웠다. 서버가 업로드 학습자료(MATERIAL 테이블)를 생성 근거로
  읽게 되면서(MaterialSource) 선생님이 자료를 직접 고르고, 프론트가 내장 자료 id 를
  조립할 일이 없어졌다.

  백엔드는 `builtin-korean-g{1..6}` 을 여전히 받는다 — 필요해지면 그 규칙만 보고 다시 만들면 된다.
*/

// ── 제출/채점 (백엔드 S15P11A407-114 구현 완료) ─────────────────

/**
 * 과제 제출 — `answers` 는 **문항 번호(문자열) → 답** 맵이다.
 * 선택형은 정답 인덱스(number), 받아쓰기(DICTATION)는 텍스트(string).
 * 예: `{ "1": 0, "2": "학교에 갔다" }`
 */
export interface SubmitRequest {
  answers: Record<string, number | string>
}

/** 문항별 채점 결과 — `conceptTags` 는 리포트의 개념별 정답률 집계에 쓰인다 */
export interface SubmissionItemResult {
  no: number
  correct: boolean
  conceptTags: string[]
}

/** 제출/채점 결과 (제출 즉시 자동 채점) */
export interface SubmissionResult {
  submissionId: number
  /** **백분율 0~100** — 맞힌 개수가 아니다 */
  score: number | null
  correctCount: number
  totalCount: number
  results: SubmissionItemResult[]
}

/**
 * 내 제출 목록 항목 (GET /me/submissions, S15P11A407-129).
 * 같은 과제를 여러 번 냈어도 **최신 시도만** 온다. 답안 본문은 상세에서 받는다.
 */
export interface MySubmission {
  submissionId: number
  assignmentId: number
  assignmentTitle: string
  subject: Subject
  type: AssignmentType
  score: number | null
  attemptNo: number
  submittedAt: string
}

/**
 * 내 답안 상세의 문항 한 줄 (S15P11A407-129 후속).
 *
 * 서버가 채점 결과(`no`·`correct`·`conceptTags`)에 **과제 content 를 문항 번호로 합쳐서**
 * 내려준다. 덕분에 화면이 과제를 따로 조회하지 않고 "내가 뭘 틀렸는지"를 한 번에 그린다.
 *
 * 과제 content 가 없거나 깨졌으면 채점 결과 칸만 오고 나머지는 undefined 다 —
 * **없다고 실패로 다루지 않는다** (있을 때만 그린다).
 */
export interface MySubmissionItemResult extends Omit<SubmissionItemResult, 'conceptTags'> {
  /**
   * 개념 태그. **null 일 수 있다** — 서버는 채점 결과의 태그를 쓰되 없으면 과제 content 의
   * 태그로 대체하고, 둘 다 없으면 null 을 넣는다(`buildReview` 의 `setOrNull`).
   * 제출 응답(`SubmissionItemResult`)의 것과 달리 항상 있다고 가정하면 안 된다.
   */
  conceptTags: string[] | null
  /** 발문. content 를 못 읽었으면 없다 */
  prompt?: string | null
  /** 선택형 보기. 받아쓰기는 null */
  choices?: string[] | null
  /** 선택형 정답 인덱스. 받아쓰기는 null */
  answer?: number | null
  /** 받아쓰기 정답 텍스트. 선택형은 null */
  answerText?: string | null
  /** 내가 고른/쓴 답 (`answers` 에서 옴) */
  myAnswer?: number | string | null
}

/**
 * 내 답안 상세 (GET /assignments/{id}/submissions/me, S15P11A407-129) — 최신 시도.
 *
 * `answers` 는 내가 쓴 답(문항번호 문자열 → 답), `results` 는 문항별 정오 + 문제 본문.
 * 서버가 저장된 JSON 이 깨져 있어도 점수·제출시각은 준다(화면 전체가 막히지 않게).
 * 그래서 `answers`/`results` 가 비어 있을 수 있다 — 없다고 실패로 다루지 않는다.
 */
export interface MySubmissionDetail {
  submissionId: number
  assignmentId: number
  assignmentTitle: string
  score: number | null
  attemptNo: number
  submittedAt: string
  answers: Record<string, number | string>
  results: MySubmissionItemResult[]
  /**
   * 과제 전체 AI 총평 — **학생에게 말하는 말투이고 숫자가 없다.**
   * 문항 결과가 없으면 null 이니 그때는 총평 영역을 숨긴다.
   *
   * 온디맨드 + 캐시다: 이 API 를 처음 열 때 한 번 만들어 저장하고 이후에는 같은 문장을 준다
   * (새로고침해도 문구가 안 바뀐다). 재제출은 새 시도라 총평도 시도마다 따로 만들어진다.
   */
  feedback: string | null
}
