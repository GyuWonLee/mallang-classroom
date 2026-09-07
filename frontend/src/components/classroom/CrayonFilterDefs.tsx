/**
 * 크레용 획 필터 정의 — 레퍼런스 teacher.html 의 `<filter id="crayon">` 이관.
 *
 * 크레용은 펜과 성질이 반대다: 끝이 뾰족하게 모이지 않고 뭉툭하며, 가장자리가 거칠고 왁스가
 * 종이에 얼룩덜룩 얹힌다. 그래서 매끈한 도형을 오려 붙이지 않고 **단색 띠에 이 필터를 씌워**
 * 거칠기와 얼룩을 만든다 (사용처: `LessonSlide` 의 수업 주제 밑줄).
 *
 * **정의는 `LessonSlide` 가 자기 안에서 직접 렌더한다.** 예전엔 선생님 라이브 페이지가
 * 한 번 깔아 뒀는데, 같은 슬라이드를 학생 화면도 쓰게 되면서 그 페이지에는 정의가 없어
 * 밑줄이 아예 사라졌다(CSS `filter:url(#없는id)` 는 요소를 그리지 않는다). 쓰는 쪽이
 * 들고 다니는 편이 안전하다 — 같은 문서에 둘이 겹치면 먼저 나온 정의가 쓰인다.
 *
 * SVG 필터는 문서 전체에서 id 로 참조된다.
 * `color-interpolation-filters="sRGB"` 는 필수 — 기본값(linearRGB)이면 노이즈가 흐리게 뜬다.
 */
export function CrayonFilterDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <filter
          id="crayon"
          x="-0.08"
          y="-1.1"
          width="1.16"
          height="3.2"
          colorInterpolationFilters="sRGB"
        >
          {/* 1) 획을 울퉁불퉁하게. 가로 주파수(첫 값)를 아주 낮게 잡는 게 핵심 —
                 길이 방향으로 완만한 물결이 생겨 띠 전체가 굽이친다. 높으면 잔털만 생기고 일자로 남는다. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.06"
            numOctaves="4"
            seed="11"
            result="n"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="n"
            scale="7"
            xChannelSelector="R"
            yChannelSelector="G"
            result="rough"
          />
          {/* 2) 왁스 얼룩. 노이즈를 굵게(baseFrequency 낮게) 잡아야 크레용 결처럼 보인다.
                 촘촘하면 모래알 같은 잡티가 된다. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.16 0.3"
            numOctaves="2"
            seed="5"
            result="g"
          />
          <feColorMatrix
            in="g"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0"
            result="ga"
          />
          {/* 표로 알파 하한을 0.25로 올린다 — 완전히 뚫리지 않아 획의 몸통이 살아 있다 */}
          <feComponentTransfer in="ga" result="gt">
            <feFuncA type="table" tableValues="0.25 0.72 0.95 1 1 0.88" />
          </feComponentTransfer>
          <feComposite in="rough" in2="gt" operator="in" />
        </filter>
      </defs>
    </svg>
  )
}
