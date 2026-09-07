import { api } from './client'
import type {
  EmailReportCardRequest,
  EmailReportCardResponse,
  ReportCardResponse,
  ReportCardSummary,
  SaveReportCardRequest,
} from '@/types/reportCard'

/**
 * 생활통지표 API — 백엔드 `report/controller/ReportCardController` ·
 * `ClassroomReportCardController` (S15P11A407-145).
 *
 * 통지표가 서버에 저장되기 전에는 이 모듈이 없었다. 선생님이 고친 평가요소·성취수준은
 * 인쇄물에만 반영되고 창을 닫으면 사라졌다 — 한 반 분량을 다시 적어야 했다.
 */
export const reportCardApi = {
  /**
   * 저장된 통지표 조회 — GET /api/classrooms/{cid}/students/{sid}/report-card.
   *
   * **아직 저장한 적 없으면 404 가 아니라 `entries: []` 인 200 이다.** 그래서 호출부는
   * 빈 배열을 "없음"으로 읽으면 되고, 없는 것을 오류로 다루지 않는다.
   *
   * 그 학급 선생님 **또는 학생 본인**만 볼 수 있다 (그 밖은 403 `report-card-forbidden`).
   */
  async get(classroomId: string, studentId: number): Promise<ReportCardResponse> {
    const { data } = await api.get<ReportCardResponse>(
      `/classrooms/${classroomId}/students/${studentId}/report-card`,
    )
    return data
  },

  /**
   * AI 초안 만들기 — POST /api/classrooms/{cid}/students/{sid}/report-card/draft (본문 없음).
   *
   * **과목마다 한 줄씩, 백엔드 `Subject` 선언 순서대로 5줄**이 온다. `evalElement` 는 그 학생의
   * 제출을 근거로 LLM 이 쓴 문장이고, 제출이 없는 과목은 **빈 문자열**이다(지어내지 않는다).
   * `area`·`rating` 은 null 로 와서 선생님이 채운다.
   *
   * 저장까지 하지는 않는다 — 초안을 보고 고친 뒤 `save` 를 불러야 남는다.
   */
  async draft(classroomId: string, studentId: number): Promise<ReportCardResponse> {
    const { data } = await api.post<ReportCardResponse>(
      `/classrooms/${classroomId}/students/${studentId}/report-card/draft`,
    )
    return data
  },

  /**
   * 저장 — PUT /api/classrooms/{cid}/students/{sid}/report-card.
   *
   * **전체 교체다.** 학급+학생당 통지표는 한 장이고, 보낸 `entries` 가 그 전부가 된다 —
   * 한 줄만 고쳐 보내면 나머지가 지워진다.
   */
  async save(
    classroomId: string,
    studentId: number,
    body: SaveReportCardRequest,
  ): Promise<ReportCardResponse> {
    const { data } = await api.put<ReportCardResponse>(
      `/classrooms/${classroomId}/students/${studentId}/report-card`,
      body,
    )
    return data
  },

  /**
   * 메일 발송 — POST /api/classrooms/{cid}/students/{sid}/report-card/email.
   *
   * 첨부 없이 보내면 저장된 내용이 글로 나간다(그래서 **저장이 먼저**다 —
   * 저장도 PDF도 없으면 400 `empty-report-card`).
   *
   * **다른 메일과 달리 실패가 화면까지 올라온다**: SMTP 설정이 없으면 503
   * `mail-not-configured` 다(학생 계정 안내 메일은 조용히 안 보내는 쪽을 택했다).
   * 그래서 여기서는 "보냈다"를 응답으로 확인할 수 있다.
   */
  async email(
    classroomId: string,
    studentId: number,
    body: EmailReportCardRequest,
  ): Promise<EmailReportCardResponse> {
    const { data } = await api.post<EmailReportCardResponse>(
      `/classrooms/${classroomId}/students/${studentId}/report-card/email`,
      body,
    )
    return data
  },

  /**
   * 학급(또는 한 학년)의 통지표 일괄 조회 — GET /api/classrooms/{cid}/report-cards?grade=.
   *
   * 학년을 생략하면 학급 전체다. 복식학급은 학년이 둘이라, 한 번에 다 받아 학생 id 로
   * 골라 쓰는 편이 학년마다 부르는 것보다 낫다. 정렬은 서버가 학년 → 이름 순으로 준다.
   */
  async listByClassroom(classroomId: string, grade?: number): Promise<ReportCardSummary[]> {
    const { data } = await api.get<ReportCardSummary[]>(
      `/classrooms/${classroomId}/report-cards`,
      { params: grade === undefined ? undefined : { grade } },
    )
    return data
  },
}
