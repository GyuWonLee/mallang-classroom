/**
 * 통지표 화면을 PDF 로 만든다 — **메일 첨부용.**
 *
 * ## 인쇄 대화상자를 두고 왜 이걸 또 만드나
 *
 * 선생님이 직접 뽑을 때는 브라우저 인쇄('대상 > PDF로 저장')가 낫다. 글자가 벡터로 남아
 * 아무리 확대해도 선명하다. 그 경로는 그대로 둔다.
 *
 * 문제는 **메일**이다. 인쇄 대화상자는 파일을 브라우저에 돌려주지 않는다 — 사용자의 디스크에
 * 저장할 뿐이라 화면이 그 바이트를 손에 쥘 수 없다. 첨부하려면 우리가 직접 만들어야 한다.
 *
 * ## 화질에 대해 정직하게
 *
 * 여기서 만든 PDF 는 **화면을 그대로 찍은 그림**이라 벡터가 아니다. 크게 확대하면 글자가
 * 부드러워진다. 다만 받는 사람은 학부모이고, A4 한 장을 화면에서 읽거나 한 번 출력하는
 * 용도다. 그 범위에서는 `scale: 2`(레티나 수준)면 충분하다.
 *
 * 벡터가 필요하면 지금도 [인쇄] 버튼을 쓰면 된다. 두 길을 함께 두는 이유가 이것이다.
 *
 * ## 무겁다 — 그래서 쓸 때만 받는다
 *
 * jspdf·html2canvas 를 합치면 수백 KB다. 통지표 메일은 자주 쓰는 기능이 아닌데 첫 화면
 * 로딩을 그만큼 늦출 이유가 없어, **함수를 부르는 순간 동적 import** 로 받아 온다.
 */

/** A4 크기(mm) — 통지표 화면도 `max-w-[210mm]` 로 A4 폭에 맞춰 그린다 */
const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297

/**
 * 주어진 엘리먼트들을 **한 장에 하나씩** 담은 PDF 를 만들어 base64(순수 데이터)로 돌려준다.
 *
 * @param pages 통지표 한 장에 해당하는 엘리먼트들. 학생이 여럿이면 여러 장이 된다.
 * @returns `data:` 접두사가 없는 base64. 서버가 접두사를 떼어 주기는 하지만 보내지 않는 편이 깔끔하다.
 */
export async function reportCardToPdfBase64(pages: HTMLElement[]): Promise<string> {
  if (pages.length === 0) {
    throw new Error('PDF 로 만들 통지표가 없습니다.')
  }
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      // 2배로 떠야 100% 로 볼 때와 인쇄물에서 글자가 깨지지 않는다
      scale: 2,
      // 통지표는 흰 종이다. 투명하게 두면 PDF 뷰어에 따라 검게 깔린다
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    })

    /*
      가로를 A4 폭에 맞추고 세로는 비율대로 늘린다. 그 결과가 A4 높이를 넘으면 세로 기준으로
      다시 맞춘다 — 넘치는 만큼 잘리는 것보다 여백이 남는 편이 낫다. 통지표는 표라서 잘리면
      한 줄이 통째로 사라진다.
    */
    const ratio = canvas.height / canvas.width
    let width = A4_WIDTH_MM
    let height = width * ratio
    if (height > A4_HEIGHT_MM) {
      height = A4_HEIGHT_MM
      width = height / ratio
    }
    const x = (A4_WIDTH_MM - width) / 2
    const y = (A4_HEIGHT_MM - height) / 2

    if (i > 0) {
      pdf.addPage()
    }
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, width, height)
  }

  // jsPDF 의 datauristring 은 "data:application/pdf;filename=...;base64,XXXX" 형태다
  const dataUri = pdf.output('datauristring')
  const marker = 'base64,'
  const at = dataUri.indexOf(marker)
  return at >= 0 ? dataUri.slice(at + marker.length) : dataUri
}
