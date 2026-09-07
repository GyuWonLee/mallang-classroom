/** 선생님 도메인 타입 — 백엔드 classroom 도메인 계약과 정렬. 네이밍 고정: classroom, team */

/** 학급 내 권한 (백엔드 ClassroomRole) */
export type ClassroomRole = 'OWNER' | 'MAINTAINER' | 'STUDENT'

/** 진행 중 / 닫혀있는 */
export type ClassStatus = 'OPEN' | 'CLOSED'

/** 과목 (카드 테마·마스코트 결정) */
export type ClassSubject = '국어' | '수학' | '영어' | '사회' | '과학'

/** 복식학급이 담당할 수 있는 최대 학년 수 */
export const MAX_CLASS_GRADES = 2
/**
 * 고를 수 있는 학년 — **초등 1~6학년의 정본**이다.
 * 학년 목록이 필요한 곳(학급 만들기·학생 발급·과제 마법사·초대 수락)은 각자 배열을
 * 다시 선언하지 말고 이걸 쓴다. 서버 검증도 `@Min(1) @Max(6)` 로 같은 범위다.
 */
export const SELECTABLE_GRADES = [1, 2, 3, 4, 5, 6] as const

/**
 * 학급 — 백엔드 ClassroomResponse (id는 문자열로 보관: 라우트 파라미터 일관성).
 *
 * `grades` 는 **서버 필드다**(S15P11A407-124). 서버가 이 학년으로 학년별 팀까지 파생하므로
 * 프론트가 따로 보관하거나 학생 명단에서 유도하지 않는다.
 * `status`(진행중/닫힘)만 서버 개념이 없어 로컬(`services/classroomMeta.ts`)에 남는다.
 */
export interface ManagedClassroom {
  id: string
  name: string
  /** 학생 아이디 접두어가 되는 자동 별칭 */
  alias: string
  myRole: ClassroomRole
  /** 이 학급이 담당하는 학년 (1~2개). 학년별 수업 카드가 이 값만 렌더한다 */
  grades: number[]
  /** 진행중/닫힘 — 표시 전용 로컬 메타 */
  status?: ClassStatus
  /*
    아래 3개는 **목록 응답의 카드용 집계**다 (백엔드 S15P11A407-137 §11.2 #6).
    예전엔 없어서 학급마다 상세를 다시 부르거나(왕복이 학급 수만큼) 아예 못 구했다.
    생성 직후처럼 집계가 필요 없는 경로는 서버가 0·null 로 비워 보낸다.
  */
  /** 학생 수 */
  studentCount: number
  /** 진행중 수업 (없으면 null) */
  activeSession: ActiveSession | null
  /**
   * 과제 진행률 0~100. **발행 과제나 학생이 없으면 null** —
   * 0% 는 "다들 안 냈다"라 빨간 막대가 되는데, 낼 게 없는 것과는 다르다.
   */
  assignmentProgress: number | null
}

/** 진행중 수업 요약 — 학급 목록·상세가 같은 모양을 쓴다 */
export interface ActiveSession {
  id: number
  startedAt: string
  /**
   * 이 수업이 맡은 학년 (백엔드 V31). **한 학급에서 학년별로 수업이 따로 돈다** —
   * 1학년은 A 선생님, 3학년은 B 선생님이 동시에 진행할 수 있다.
   *
   * null 은 학급 전체 수업이다. 이 열이 생기기 전에 시작된 수업이 그렇고, 그 수업이
   * 열려 있으면 학년 수업을 새로 열 수 없다(서버가 409 로 막는다).
   */
  grade: number | null
  /**
   * 이 수업을 연 선생님.
   *
   * **누가 열었는지를 알아야 카드를 미리 잠글 수 있다.** 수업은 연 사람만 들어갈 수 있는데
   * (S15P11A407-147, 403 `not-session-teacher`), 이 값이 없던 때는 화면이 그걸 몰라서
   * '이 수업 들어가기'를 눌러 403 을 받고 나서야 잠갔다 — 선생님에게 한 번의 헛걸음이었다.
   *
   * 옛 응답에는 없으므로 optional 이다. 없으면 예전처럼 눌러 보고 판단한다.
   */
  startedById?: number
  startedByName?: string
}

/** 학급 생성 입력 — 이름 + 담당 학년(1~2개). 과목/단원은 받지 않는다(국어 전용) */
export interface CreateClassroomInput {
  name: string
  grades: number[]
}

/** 학생 계정 생성 요청 (백엔드 CreateStudentRequest) */
export interface CreateStudentRequest {
  name: string
  school: string
  /** 1~6 */
  grade: number
  /**
   * 학부모 이메일 — **선택**. 넣으면 서버가 아이디·임시 비밀번호 안내 메일을 그 주소로 보낸다
   * (CSV 4번째 열과 같은 값이다). 발송은 커밋 뒤 비동기라 응답에 결과가 없다.
   *
   * 형식이 틀린 주소는 서버의 `@Email` 에 걸려 **계정 생성까지 400 으로 함께 실패한다**(메일만
   * 빠지는 게 아니다). 그래서 화면에서 먼저 걸러 낸다. 안 적었으면 키 자체를 빼고 보낸다.
   */
  parentEmail?: string
}

/**
 * 학생 계정 (백엔드 StudentAccountResponse / StudentSummaryResponse).
 *
 * temporaryPassword 는 **발급 응답에서 단 한 번만** 평문으로 내려온다(DB엔 BCrypt 해시만).
 * 명단 조회(GET .../students)에는 없으므로 optional — 화면은 있을 때만 보여준다.
 */
export interface StudentAccount {
  userId: number
  username: string
  temporaryPassword?: string
  name: string
  school: string
  grade: number
}

/**
 * CSV 미리보기 한 행 (백엔드 StudentCsvRowResponse) — **아직 만들어지지 않은** 학생이다.
 *
 * `StudentAccount` 와 일부러 다른 타입이다. 저쪽에는 userId·아이디·임시 비밀번호가 있는데,
 * 미리보기에는 파일에 적힌 것만 있다 — 같은 타입을 쓰면 화면이 "이미 등록됐다"고 읽는다.
 */
export interface StudentCsvRow {
  name: string
  school: string
  grade: number
  /** 없으면 null — 안내 메일이 가지 않는 행이다 */
  parentEmail: string | null
}

/** 학급 상세 (GET /classrooms/{id}) — 진행중 수업 여부 포함 */
export interface ClassroomDetail {
  id: number
  name: string
  school: string
  myRole: ClassroomRole
  /** 담당 학년 1~2개 */
  grades: number[]
  memberCounts: { teachers: number; students: number }
  /**
   * 진행중 수업 (없으면 null).
   *
   * @deprecated 학년별 수업이 생기면서(V31) 한 학급에 여러 개가 열린다. 여기엔 그중 하나만
   *             담기므로 `activeSessions` 를 쓸 것. 서버가 한 버전 동안 함께 내려준다.
   */
  activeSession: ActiveSession | null
  /** 진행중 수업 전부 — 학년 오름차순. 없으면 빈 배열이다(null 아님) */
  activeSessions: ActiveSession[]
}

/**
 * 학생 메모 (GET/POST /classrooms/{id}/students/{sid}/notes — 백엔드 S15P11A407-137 §11.3 #8).
 *
 * **선생님 전용이다 — 학생 본인은 볼 수 없다.** 학급에 선생님이 여럿이면 "누가 본 것인지"가
 * 내용만큼 중요해서 `authorName` 이 함께 온다. 고치고 지우는 건 작성자만 되고,
 * 지금 보는 사람이 작성자인지는 서버가 `editable` 로 알려 준다(역할로 추측하지 말 것).
 */
export interface StudentNote {
  id: number
  content: string
  authorId: number
  authorName: string
  editable: boolean
  createdAt: string
  updatedAt: string
}

/** 학급 구성원 (GET /classrooms/{id}/members) */
export interface ClassroomMember {
  userId: number
  name: string
  role: ClassroomRole
  /** 소속 팀 (미배정이면 null) */
  teamId: number | null
  grade: number | null
}

/** 학급 정보 수정 요청 (PATCH /classrooms/{id}) */
/**
 * 학급 수정 (PATCH /classrooms/{id}).
 * 백엔드는 `name` 을 **필수**로 받고, `grades` 를 함께 주면 담당 학년까지 교체한다.
 * `school` 은 학급 컬럼이 아니라 OWNER 선생님 소속에서 나오므로 보내도 무시된다.
 */
export interface UpdateClassroomRequest {
  name: string
  /** 생략하면 학년은 그대로, 주면 1~2개로 교체 */
  grades?: number[]
}
