import type { StudentAccount } from '@/types/teacher'

/**
 * 발급된 학생 계정(아이디 · 임시 비밀번호)을 파일로 내보낸다.
 *
 * 임시 비밀번호는 **발급 응답에서 딱 한 번** 내려오고 서버에는 BCrypt 해시만 남는다.
 * 그래서 이 화면을 벗어나면 다시 볼 방법이 없고, 놓치면 학생마다 초기화를 다시 돌려야 한다.
 * 여기서 하는 일은 이미 화면에 떠 있는 값을 파일로 떨구는 것뿐이라 노출 범위가 늘지 않는다.
 *
 * 다만 파일은 내려받은 PC 에 평문으로 **계속 남는다.** 학생이 첫 로그인 후 비밀번호를
 * 바꾸면 그 파일은 쓸모없어지므로, 안내 문구로 그것을 유도한다.
 */

/** 임시 비밀번호가 실려 있는 계정만 — 명단 조회로 받아온 항목에는 없다 */
export function withCredentials(accounts: StudentAccount[]): StudentAccount[] {
  return accounts.filter((a) => Boolean(a.temporaryPassword))
}

/**
 * CSV 한 칸을 안전하게 감싼다.
 *
 * `=`·`+`·`-`·`@` 로 시작하는 값은 엑셀이 **수식으로 해석**한다(CSV 인젝션). 이름은
 * 선생님이 CSV 로 올린 값이 그대로 들어오므로 통제할 수 없다고 보고 앞에 홑따옴표를 붙인다.
 */
function cell(value: string): string {
  const escaped = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${escaped.replace(/"/g, '""')}"`
}

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * CSV 로 내려받는다.
 *
 * 앞에 BOM 을 붙인다 — 없으면 엑셀이 UTF-8 을 못 알아보고 한글 이름이 전부 깨진다.
 */
export function downloadCredentialsCsv(accounts: StudentAccount[], classroomName?: string) {
  const rows = withCredentials(accounts)
  if (rows.length === 0) return

  const header = ['이름', '학년', '아이디', '임시 비밀번호']
  const body = rows.map((a) =>
    [a.name, `${a.grade}학년`, a.username, a.temporaryPassword ?? ''].map(cell).join(','),
  )
  const csv = ['﻿' + header.map(cell).join(','), ...body].join('\r\n')

  const label = classroomName ? `${classroomName}_` : ''
  triggerDownload(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `학생계정_${label}${today()}.csv`,
  )
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

/**
 * 학생별로 잘라 나눠 줄 배부표를 인쇄한다.
 *
 * 학교에서는 CSV 보다 이쪽이 실용적이다 — 종이로 잘라 학생에게 한 장씩 주면 되고,
 * 선생님 PC 에 파일이 남지 않는다.
 *
 * 새 창에 직접 그린다. 앱 DOM 에 인쇄 전용 마크업을 심으면 화면 스타일과 얽혀
 * 유지보수가 어려워지는데, 배부표는 앱 디자인과 무관하게 흑백으로 단순해야 한다.
 */
export function printCredentialSlips(accounts: StudentAccount[], classroomName?: string): boolean {
  const rows = withCredentials(accounts)
  if (rows.length === 0) return true

  const win = window.open('', '_blank')
  // 팝업 차단 — 호출한 쪽에서 안내한다
  if (!win) return false

  const slips = rows
    .map(
      (a) => `
      <div class="slip">
        <div class="who">${escapeHtml(a.name)} <span class="grade">${a.grade}학년</span></div>
        <dl>
          <dt>아이디</dt><dd>${escapeHtml(a.username)}</dd>
          <dt>비밀번호</dt><dd>${escapeHtml(a.temporaryPassword ?? '')}</dd>
        </dl>
        <p class="note">처음 로그인한 뒤 비밀번호를 바꿔 주세요.</p>
      </div>`,
    )
    .join('')

  win.document.write(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>학생 계정 배부표${classroomName ? ` — ${escapeHtml(classroomName)}` : ''}</title>
<style>
  @page { margin: 12mm; }
  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; margin: 0; color: #000; }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  .lead { font-size: 9pt; color: #444; margin: 0 0 6mm; }
  .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  /* 가위로 자르는 선 — 점선이라야 어디를 자를지 헷갈리지 않는다 */
  .slip { border: 1px dashed #666; border-radius: 2mm; padding: 4mm 5mm; break-inside: avoid; }
  .who { font-size: 12pt; font-weight: 700; margin-bottom: 2mm; }
  .grade { font-size: 9pt; font-weight: 400; color: #555; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 1mm 3mm; margin: 0; }
  dt { font-size: 9pt; color: #555; }
  /* 임시 비밀번호는 옮겨 적는 값이라 고정폭이 안전하다 */
  dd { margin: 0; font-family: 'D2Coding', Consolas, monospace; font-size: 11pt; font-weight: 700; letter-spacing: .5px; }
  .note { font-size: 8pt; color: #555; margin: 3mm 0 0; }
</style></head>
<body>
  <h1>학생 계정 배부표${classroomName ? ` · ${escapeHtml(classroomName)}` : ''}</h1>
  <p class="lead">점선을 따라 잘라 학생에게 한 장씩 나눠 주세요. 이 종이에는 비밀번호가 적혀 있으니 남지 않게 해 주세요.</p>
  <div class="sheet">${slips}</div>
</body></html>`)
  win.document.close()
  win.focus()
  win.print()
  return true
}
