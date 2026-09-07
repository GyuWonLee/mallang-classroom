/**
 * 백엔드 에러(RFC 9457 Problem Details)를 사람이 읽는 한국어 문장으로.
 *
 * 백엔드는 `{ type: "https://mallang.app/errors/{slug}", title, status, detail }` 을 준다.
 * `type` 의 마지막 세그먼트(slug)가 에러 분기의 기준이고, 우리가 아는 slug 는 서비스 문맥에
 * 맞는 문장으로 바꿔준다. 모르는 slug 는 서버의 `detail` 을 그대로 쓴다 — 서버 문장이
 * 이미 한국어라서 raw axios 메시지("Request failed with status code 403")보다 훨씬 낫다.
 */
interface ProblemDetails {
  type?: string
  title?: string
  detail?: string
  status?: number
  /** `validation-failed` 일 때만 — 필드별 사유 (GlobalExceptionHandler 가 실어 보낸다) */
  errors?: { field?: string; message?: string }[]
}

function problemOf(error: unknown): ProblemDetails | undefined {
  return (error as { response?: { data?: ProblemDetails } })?.response?.data
}

/**
 * HTTP 상태 코드.
 *
 * 실패를 **한 덩어리로 다루면 안 되는** 자리에서 쓴다 — 예를 들어 403(내 것이 아니다)은
 * 화면에서 대상을 지우는 게 맞지만, 500 은 대상이 없어진 게 아니라 서버가 잠깐 못 답한
 * 것이라 지우면 거짓말이 된다. 응답이 아예 없으면(네트워크 단절) undefined 다.
 */
export function errorStatus(error: unknown): number | undefined {
  return (
    problemOf(error)?.status ?? (error as { response?: { status?: number } })?.response?.status
  )
}

/** 에러 종류 식별용 slug (`.../errors/owner-only` -> `owner-only`) */
export function errorSlug(error: unknown): string | undefined {
  const type = problemOf(error)?.type
  if (!type) return undefined
  const slug = type.split('/').pop()
  return slug || undefined
}

const MESSAGES: Record<string, string> = {
  'owner-only': '이 수업을 만든 선생님만 삭제할 수 있어요.',
  'not-a-member': '이 학급의 구성원이 아니에요.',
  'manager-only': '학급을 관리할 수 있는 선생님만 할 수 있어요.',
  'owner-not-removable': '담당 선생님은 제외할 수 없어요. 수업을 삭제해 주세요.',
  'classroom-not-found': '이미 삭제된 수업이에요.',
  'session-already-open': '이미 진행 중인 수업이 있어요.',
  'session-not-found': '수업을 찾을 수 없어요.',
  'session-closed': '이미 종료된 수업이에요.',
  'kicked-from-session': '이 수업에는 다시 들어갈 수 없어요.',
  'invite-expired': '만료됐거나 사용 횟수를 다 쓴 초대예요.',
  // 손으로 적는 코드가 생기면서(학급 참여 모달·로그인 화면) 오타가 가장 흔한 실패가 됐다
  'invite-not-found': '이런 초대 코드가 없어요. 코드를 다시 확인해 주세요.',
  'teacher-login-required': '선생님 계정으로 로그인한 뒤 다시 시도해 주세요.',
  'student-info-required': '이름·학교·학년·비밀번호를 모두 입력해 주세요.',
  'already-a-member': '이미 이 학급의 구성원이에요.',
  // 백엔드는 선생님 회원가입의 이메일 중복에도 이 slug 를 쓴다(AuthService) — 문구를 그에 맞춘다
  'duplicate-username': '이미 사용 중인 이메일이에요. 다른 이메일로 가입해 주세요.',
  'unauthorized': '로그인이 필요해요. 다시 로그인해 주세요.',
  'invalid-credentials': '아이디 또는 비밀번호를 확인해 주세요.',
  // 비밀번호 변경 (S15P11A407-131)
  'invalid-current-password': '지금 쓰는 비밀번호가 올바르지 않아요.',
  'same-password': '지금 쓰는 비밀번호와 다른 것으로 정해 주세요.',
  'material-not-ready': '아직 사용할 수 없는 학습자료예요.',
  'not-in-preview': '미리보기 확인이 끝난 자료라 다시 확인할 수 없어요.',
  'generation-job-expired': '생성 결과가 만료됐어요. 다시 만들어 주세요.',
  'file-too-large': '파일이 너무 커요.',
  'unsupported-content-type': '지원하지 않는 파일 형식이에요.',
  'livekit-not-configured': '화상 수업 서버가 준비되지 않았어요. 관리자에게 알려주세요.',

  /*
    수업을 시작한 선생님만 그 수업에 들어가고·보고·끝낼 수 있다 (S15P11A407-147).
    복식학급에 선생님이 둘 이상이면 **정상적으로 자주 나는 응답**이라, 화면은 이걸 오류
    토스트가 아니라 "다른 선생님이 진행 중" 상태로 그린다 (lib/session.ts 참고).
  */
  'not-session-teacher': '지금 수업은 다른 선생님이 진행 중이에요.',
  'session-not-open': '진행 중인 수업이 없어요. 수업을 먼저 시작해 주세요.',
  'invalid-grade': '학년은 1~6 사이로 골라 주세요.',
  'grade-not-in-classroom': '이 학급이 담당하지 않는 학년이에요.',

  // AI 과제 생성 (S15P11A407-145) — 읽어 줄 본문이 있어야 받아쓰기가 된다
  'dictation-subject-not-allowed': '받아쓰기는 국어·영어에서만 만들 수 있어요.',
  'assignment-content-locked': '이미 공개한 과제는 문항을 바꿀 수 없어요.',
  'assignment-not-assigned': '이 과제는 볼 수 있는 대상이 아니에요.',

  // 비밀번호 재설정 메일 (S15P11A407 auth) — 링크는 30분짜리 1회용이다
  'invalid-reset-token':
    '링크가 만료됐거나 이미 사용됐어요. 비밀번호 찾기를 다시 해 주세요.',
  /*
    재설정 요청 제한 — 이메일당 1시간 3회, IP당 10분 10회. **학교는 공용 IP 라** 여러
    선생님이 몰리면 자기 이메일은 처음이어도 IP 쪽에 먼저 걸린다. 그래서 "이미 보냈어요"가
    아니라 시간을 두고 다시 하라고 말한다.
  */
  'too-many-requests': '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.',

  // 생활통지표 (S15P11A407-145)
  'report-card-forbidden': '이 학생의 통지표를 볼 수 있는 권한이 없어요.',
  'empty-report-card': '보낼 내용이 없어요. 통지표를 먼저 저장해 주세요.',
  'invalid-pdf': '통지표 파일을 만들지 못했어요. 다시 시도해 주세요.',
  'mail-not-configured': '메일 보내기가 준비되지 않았어요. 관리자에게 알려주세요.',
  'student-not-found': '학생을 찾을 수 없어요. 명단을 새로고침해 주세요.',

  // 말랑이 위험 신호 (ce47a1f) — 학급 선생님만 볼 수 있다
  'tutor-flags-forbidden': '학급 선생님만 볼 수 있어요.',

  /*
    새로 생긴 전역 409 — 같은 요청이 두 번 겹쳤을 때 500 대신 이걸 준다
    (`GlobalExceptionHandler`). **다시 시도하면 되는 실패**라 문장도 그렇게 적는다.
  */
  'conflict': '이미 처리된 요청이거나 다른 요청과 겹쳤어요. 잠시 뒤에 다시 시도해 주세요.',
}

/**
 * 요청은 나갔는데 응답을 못 받았나 (끊긴 회선·서버 미기동·CORS 차단).
 *
 * axios 오류가 아니면 애초에 통신이 아니다 — 화면 코드가 던진 예외이거나 버그다.
 * 그런 것까지 연결 탓으로 돌리면 진짜 원인이 영영 안 보인다.
 */
function isNetworkFailure(error: unknown): boolean {
  const e = error as { isAxiosError?: boolean; request?: unknown; response?: unknown }
  return e?.isAxiosError === true && !e.response && e.request != null
}

/** 서버 문장을 그대로 보여주면 안 되는 경우 — 개발자용 메시지가 그대로 노출된다 */
function looksTechnical(detail: string): boolean {
  return (
    detail.length > 160 ||
    // 스택 트레이스·예외 클래스·SQL 조각 (한글 안내문에는 나오지 않는 모양들)
    /(\bException\b|\bError:\s|\bat [\w$.]+\(|[\w.]+\.java:\d+|SELECT\s|Cannot invoke|NullPointer)/.test(
      detail,
    ) ||
    // 한글이 한 글자도 없으면 사용자용 문장이 아니다
    !/[가-힣]/.test(detail)
  )
}

/**
 * 사용자에게 보여줄 문장.
 *
 * 우선순위: 우리가 아는 slug → (사용자용으로 보이는) 서버 detail → 상태코드별 안내 → fallback.
 * **서버 detail 을 무조건 믿지 않는다** — 500 이나 프레임워크 기본 응답은 자바 예외 문구가
 * 그대로 담겨 오는데, 그걸 화면에 띄우면 선생님·학생이 읽을 수 없는 메시지를 보게 된다.
 *
 * 404 는 대상이 이미 없어진 경우가 많아 호출부가 성공처럼 처리하고 싶을 수 있다 → `errorSlug` 참고.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const slug = errorSlug(error)
  if (slug && MESSAGES[slug]) return MESSAGES[slug]

  const problem = problemOf(error)
  const status = errorStatus(error)

  /*
    **정말로 통신이 실패했을 때만** 연결 탓을 한다.

    예전에는 `.response` 가 없기만 하면 이 문장을 돌려줬다. 그런데 그 조건은 axios 가 아닌
    보통 예외에도 전부 걸린다 — 화면 코드가 던진 `new Error(...)`, 오타로 난 TypeError까지
    "인터넷 연결이 불안정해요"가 됐다. 선생님은 멀쩡한 회선을 의심하며 다시 눌러 보고,
    고치는 쪽은 진짜 원인을 가리키는 단서를 잃는다. 호출부가 정성껏 적어 둔 fallback 문장도
    이 줄에 가려 한 번도 쓰이지 않았다.

    axios 는 자기 오류에 `isAxiosError` 를 달고, 요청은 나갔는데 응답이 없을 때만 `request`
    가 남는다. 둘을 함께 보면 "요청이 나갔다가 답을 못 받았다"만 정확히 걸러진다.
  */
  if (isNetworkFailure(error)) {
    return '인터넷 연결이 불안정해요. 연결을 확인한 뒤 다시 시도해 주세요.'
  }

  /*
    검증 실패는 detail 이 "요청 값이 올바르지 않습니다." 로 뭉개져 와서 무엇을 고쳐야 하는지
    알 수 없다. 정작 쓸모 있는 건 필드별 message 라 그쪽을 먼저 보여준다.
  */
  if (slug === 'validation-failed') {
    const first = problem?.errors?.find((e) => e.message)?.message
    if (first) return first
  }

  if (problem?.detail && !looksTechnical(problem.detail)) return problem.detail

  if (status === 401) return '로그인이 필요해요. 다시 로그인해 주세요.'
  if (status === 403) return '이 작업을 할 권한이 없어요.'
  if (status === 404) return '대상을 찾을 수 없어요. 새로고침한 뒤 다시 확인해 주세요.'
  if (status === 409) return '지금 상태에서는 할 수 없는 작업이에요. 화면을 새로고침해 주세요.'
  if (status === 413) return '파일이 너무 커요.'
  if (status === 429) return '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.'
  if (status !== undefined && status >= 500) {
    return '서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.'
  }
  return fallback
}
