import type { CSSProperties } from 'react'
import { Icon } from '@/components/common/Icon'
import { CrayonFilterDefs } from './CrayonFilterDefs'
import { subjectImage } from '@/lib/subject'
import { cn } from '@/lib/cn'

/**
 * 크레용 밑줄 (ref .bpn-topic::after). Tailwind 임의값으로 쓰면 calc 연산자 공백과
 * 벤더 접두사 mask 가 툴체인마다 다르게 처리돼서, 값이 그대로 나가는 인라인 스타일로 둔다.
 * 색만 토큰(bg-primary)이 담당한다.
 *
 *  - `filter:url(#crayon)` 이 단색 띠의 가장자리를 변위시키고 알파 노이즈로 왁스 얼룩을 만든다
 *    (필터 정의는 화면이 한 번 렌더하는 `<CrayonFilterDefs />`).
 *  - 양끝은 그라데이션 마스크로 흐리게 뺀다 — 도형 마스크로 오리면 필터가 만든 거친
 *    가장자리가 다시 매끈하게 잘려 나간다.
 *  - 글자보다 살짝 넘겨 긋는다(+16px / -6px) — 딱 맞게 끝나면 자로 잰 느낌이 남는다.
 */
const CRAYON_MASK =
  'linear-gradient(90deg,transparent 0,#000 10px,#000 calc(100% - 15px),transparent 100%)'
const CRAYON_UNDERLINE: CSSProperties = {
  height: '9px',
  width: 'calc(100% + 16px)',
  marginLeft: '-6px',
  opacity: 0.95,
  filter: 'url(#crayon)',
  WebkitMaskImage: CRAYON_MASK,
  maskImage: CRAYON_MASK,
  transform: 'rotate(-.5deg)',
}

/**
 * 수업 주제 슬라이드 — 공책 질감(cam_bg) 위에 오늘의 주제를 크레용 밑줄과 함께 얹은 화면.
 * ref teacher.html `.bpn-slide`.
 *
 * **선생님 화면과 학생 화면이 같은 것을 본다.** 원래는 선생님 방송 패널 안에만 있었고,
 * 학생은 방송이 없는 동안 빈 화면이나 '기다리고 있어요' 안내만 봤다 — 같은 수업에 들어와
 * 있는데 두 사람이 서로 다른 화면을 보고 있었던 셈이다. 그래서 파일로 분리했다.
 *
 * 방송(카메라·화면 공유)이 켜지면 호출부가 이 위를 영상으로 덮는다. 이 컴포넌트는 자기
 * 자리를 채우기만 하고, 무엇이 위에 올라오는지는 모른다.
 */
export function LessonSlide({
  topic,
  className,
  /**
   * 슬라이드 아래에 붙는 한 줄. 선생님과 학생에게 필요한 말이 다르다 —
   * 선생님은 "켜면 나간다", 학생은 "선생님이 켜면 보인다".
   */
  hint,
}: {
  topic: string
  className?: string
  hint?: string
}) {
  return (
    <div
      className={cn(
        'relative isolate flex h-full w-full flex-col justify-center overflow-hidden rounded-tile bg-paper p-[34px_40px_34px_11%]',
        className,
      )}
    >
      {/* 밑줄이 filter:url(#crayon) 로 참조하는 SVG 필터 — 쓰는 쪽이 들고 다닌다 */}
      <CrayonFilterDefs />

      {/* 공책 질감 — 이미지 여백만큼 밖으로 밀어 끝까지 닿게 한다 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-[8.7%] -bottom-[10.92%] -left-[1.63%] -right-[1.96%] -z-10 bg-[url('/assets/cam_bg.webp')] bg-[length:100%_100%] bg-no-repeat"
      />

      {/* 종이 위에 흩뿌린 + 장식 (ref .bpn-deco) */}
      <Icon
        name="plus"
        aria-hidden="true"
        className="pointer-events-none absolute right-[300px] top-11 h-9 w-9 text-[#5B9BD9] opacity-85 max-[900px]:hidden"
      />
      <Icon
        name="plus"
        aria-hidden="true"
        className="pointer-events-none absolute right-[252px] top-24 h-[22px] w-[22px] text-[#5B9BD9] opacity-60 max-[900px]:hidden"
      />

      <p className="text-[.95rem] font-extrabold text-primary">오늘의 수업 주제</p>
      {/*
        self-start 로 제목 폭을 글자 길이에 맞춘다 → 밑줄 width:100% 가 곧 제목 길이.
        밑줄은 크레용으로 슥 그은 자국이다: 단색 띠에 #crayon 필터(가장자리 변위 + 알파
        노이즈)를 씌우고 양끝만 그라데이션 마스크로 흐리게 뺀다. 도형으로 오려내면
        필터가 만든 거친 가장자리가 다시 매끈해지므로 mask 는 그라데이션만 쓴다.
      */}
      <h2 className="mt-2.5 max-w-full self-start text-[2.1rem] font-black leading-[1.2] tracking-[-.5px] max-[900px]:text-[1.5rem]">
        {topic}
        <span aria-hidden="true" className="mt-0.5 block bg-primary" style={CRAYON_UNDERLINE} />
      </h2>
      {hint && (
        <p className="mt-4 max-w-[62%] text-[1.02rem] font-semibold leading-[1.65] text-ink-soft max-[900px]:text-[.88rem]">
          {hint}
        </p>
      )}

      <img
        src={subjectImage()}
        alt=""
        aria-hidden="true"
        /* 과목 그림 5장은 모두 424x386 이라 한 값으로 비율을 고정할 수 있다 (lib/subject.ts) */
        width={424}
        height={386}
        decoding="async"
        className="pointer-events-none absolute right-11 top-1/2 h-auto w-[210px] max-w-[34%] -translate-y-1/2 object-contain"
      />

      {/*
        캐릭터 옆 말풍선("수업을 시작해볼까요?")은 없앴다 — 선생님 요청.
        빈 무대가 "고장난 화면"으로 읽히지 않게 두었던 장치인데, 아래 `hint` 한 줄이 이미
        같은 말을 하고 있어 화면에 문구가 둘이었다.
      */}
    </div>
  )
}
