import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
  pdf.js 가 **런타임에 받아 가는 데이터**를 정적 자산으로 옮긴다.

  PDF 를 그리려면 두 가지가 더 필요하다. 번들에 들어가지 않고 필요할 때 URL 로 받아 간다:
   - cmaps/         CID 글꼴의 문자 대응표. **한글 PDF 는 거의 다 CID 라 이게 없으면 못 그린다.**
   - standard_fonts/ Helvetica·Times 처럼 파일에 글꼴이 안 박힌 경우 쓰는 표준 14종.

  둘 다 없으면 `getDocument` 는 성공하는데 `render` 가 **끝나지 않는다** — 오류도 안 나서
  화면에는 빈 종이나 "열지 못했어요"만 남는다. 실제로 그 상태였다.

  ## 왜 저장소에 커밋하지 않나

  185개 파일 2.3MB 다. 우리가 고칠 일이 없는 라이브러리 데이터를 저장소에 넣으면 diff 와
  클론이 그만큼 무거워진다. 배포는 `npm ci` 로 node_modules 를 채운 뒤 빌드하므로 그때
  복사하면 된다(package.json 의 predev·prebuild).

  `public/` 아래로 넣는 이유는 Vite 가 그 폴더를 **가공 없이 그대로** dist 로 옮기기 때문이다.
  해시가 붙지 않아 pdf.js 에 넘기는 경로가 고정된다.
*/

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const from = resolve(root, 'node_modules/pdfjs-dist')
const to = resolve(root, 'public/pdfjs')

const PARTS = ['cmaps', 'standard_fonts']

if (!existsSync(from)) {
  // 의존성이 아직 없으면 조용히 넘어간다 — install 전에 도는 스크립트가 빌드를 막으면 안 된다
  console.warn('[pdfjs] node_modules/pdfjs-dist 가 없어 건너뜁니다')
  process.exit(0)
}

await rm(to, { recursive: true, force: true })
await mkdir(to, { recursive: true })
for (const part of PARTS) {
  await cp(resolve(from, part), resolve(to, part), { recursive: true })
}
console.log(`[pdfjs] ${PARTS.join(', ')} → public/pdfjs/`)
