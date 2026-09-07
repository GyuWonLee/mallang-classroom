/**
 * 생활통지표 서버 계약 — 백엔드 `report/dto/ReportCardDtos.java` (S15P11A407-145).
 *
 * 통지표가 서버에 살게 되면서 생긴 타입들이다. 예전에는 통지표가 **인쇄물에만 존재했고**
 * 선생님이 고친 값은 창을 닫으면 사라졌다(`lib/reportCard.ts` 주석 참고).
 *
 * 화면이 쓰는 표 모델(`EvalRow`)과는 **모양이 다르다**:
 *  - 서버 `Entry` 는 교과마다 한 줄이고 정답률·문항 수를 모른다(선생님이 쓴 문장과 평가만 담는다).
 *  - 화면 `EvalRow` 는 개념 태그별로 여러 줄이고 자동 채점에서 나온 정답률을 갖는다.
 * 둘을 옮기는 함수는 `lib/reportCard.ts` 의 `entriesToRows` / `rowsToEntries` 한 곳에 있다.
 */

/**
 * 통지표 한 줄.
 *
 * `subject` 는 **백엔드 `Subject` enum 이름**(`"KOREAN"`)이다 — 한글 표기는 서버가 주지 않는다
 * (`subjectLabel` 을 응답에서 일부러 뺐다, 72c7bce). `lib/subject.ts` 의 `SUBJECT_LABEL` 로 옮긴다.
 *
 * `area`·`rating` 은 초안 단계에서 `null` 이다 — 선생님이 채우는 칸이다.
 * `rating` 은 서버 쪽 제약이 없는 자유 문자열이라, 화면이 아는 4단계가 아닐 수 있다.
 */
export interface ReportCardEntry {
  subject: string
  /** 영역 (예: '문법'). 초안에는 없다 */
  area: string | null
  /** 평가요소 문장 — 초안이면 LLM 이 쓴 것, 그 학생 제출이 없으면 빈 문자열 */
  evalElement: string | null
  /** 성취수준 (매우잘함/잘함/보통/노력요함). 초안에는 없다 */
  rating: string | null
}

/** GET·PUT·POST draft 의 공통 응답. 저장 전이면 `entries` 가 빈 배열이다(404 가 아니다) */
export interface ReportCardResponse {
  studentId: number
  entries: ReportCardEntry[]
}

/** PUT 본문 — **전체 교체**다. 보낸 것이 그 학생 통지표의 전부가 된다 */
export interface SaveReportCardRequest {
  entries: ReportCardEntry[]
}

/**
 * 학급/학년 일괄 조회 한 줄 (GET /classrooms/{id}/report-cards).
 * `saved` 가 false 면 `entries` 는 빈 배열이다.
 */
export interface ReportCardSummary {
  studentId: number
  studentName: string
  grade: number | null
  saved: boolean
  entries: ReportCardEntry[]
}

/**
 * 통지표 메일 발송 요청.
 *
 * `pdfBase64` 를 **보내지 않으면** 서버가 저장된 `entries` 를 글로 풀어 본문에 담는다.
 * 그래서 첨부 없이 보낼 때는 **먼저 저장돼 있어야 한다** — 저장도 PDF도 없으면
 * 400 `empty-report-card` 다.
 */
export interface EmailReportCardRequest {
  recipientEmail: string
  /** `data:` 접두사가 붙어 있어도 서버가 떼어낸다. 형식이 깨지면 400 `invalid-pdf` */
  pdfBase64?: string
  /** 생략하면 서버가 `{학생이름}_생활통지표.pdf` 로 정한다 */
  filename?: string
  /** 본문에 얹을 인사말 */
  message?: string
}

export interface EmailReportCardResponse {
  sent: boolean
  recipientEmail: string
}
