import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/common/Icon'
import { cn } from '@/lib/cn'
import type { AnnotationTool } from '@/services/media/ScreenAnnotator'

/**
 * 필기 팔레트 — 순수 프레젠테이셔널(상태는 부모/훅이 소유).
 *
 * 색은 `@theme` 토큰만 쓴다(Rule 5). 다만 캔버스 `strokeStyle` 과 STOMP 로 나가는 획에는
 * `var(--color-*)` 를 그대로 넘길 수 없으므로, **칩의 실제 계산색을 읽어서** 값으로 쓴다.
 * 그래서 index.css 에서 토큰 값을 바꾸면 팔레트도 같이 바뀌고, 이 파일엔 hex 가 하나도 없다.
 */
const PALETTE = [
  { key: 'danger', swatch: 'bg-danger', label: '빨강' },
  { key: 'primary', swatch: 'bg-primary', label: '파랑' },
  { key: 'mint', swatch: 'bg-mint-deep', label: '초록' },
  { key: 'task', swatch: 'bg-task', label: '노랑' },
  { key: 'white', swatch: 'bg-card', label: '흰색' },
] as const

const WIDTHS: { label: string; value: number }[] = [
  { label: '얇게', value: 3 },
  { label: '보통', value: 6 },
  { label: '굵게', value: 12 },
]

interface AnnotationToolbarProps {
  tool: AnnotationTool
  color: string
  width: number
  canUndo: boolean
  /** 지울 것이 남아 있는가 — 교사는 남의 획도 대상이라 `canUndo` 와 다르다 (ScreenAnnotator) */
  canClear: boolean
  /** 칠판을 통째로 비울 수 있는가(교사). 학생이면 '내가 그린 것 전부'가 된다 */
  canClearAll?: boolean
  onTool: (tool: AnnotationTool) => void
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onUndo: () => void
  onClear: () => void
}

export function AnnotationToolbar({
  tool,
  color,
  width,
  canUndo,
  canClear,
  canClearAll = false,
  onTool,
  onColor,
  onWidth,
  onUndo,
  onClear,
}: AnnotationToolbarProps) {
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([])
  /** 칩에서 읽어낸 실제 색 값 (rgb(...)) — 캔버스와 실시간 획이 쓰는 값 */
  const [values, setValues] = useState<string[]>([])
  // 최초 1회 효과에서 최신 값을 쓰기 위한 통로 (토큰은 런타임에 바뀌지 않아 재실행이 필요 없다)
  const latest = useRef({ color, onColor })
  latest.current = { color, onColor }

  useEffect(() => {
    const read = swatchRefs.current.map((el) => (el ? getComputedStyle(el).backgroundColor : ''))
    setValues(read)
    /*
      엔진 기본색이 팔레트 밖 값이면 어떤 칩도 선택돼 보이지 않는다. 첫 색으로 맞춰서
      "지금 무슨 색으로 그리는지"가 항상 화면에 드러나게 한다.
    */
    if (read[0] && !read.includes(latest.current.color)) latest.current.onColor(read[0])
  }, [])

  /** ref `.icon-btn` — 38x38 원형, 아이콘 16px */
  const iconBtn =
    'grid h-[38px] w-[38px] place-items-center rounded-full transition-transform hover:scale-110'

  return (
    <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full bg-white/95 px-3 py-2 shadow-card-lg backdrop-blur">
      {/* 펜 / 지우개 */}
      <button
        type="button"
        aria-label="펜"
        aria-pressed={tool === 'pen'}
        onClick={() => onTool('pen')}
        className={cn(iconBtn, tool === 'pen' ? 'bg-primary text-white' : 'bg-canvas text-ink')}
      >
        <Icon name="edit" className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="지우개"
        aria-pressed={tool === 'eraser'}
        onClick={() => onTool('eraser')}
        className={cn(iconBtn, tool === 'eraser' ? 'bg-primary text-white' : 'bg-canvas text-ink')}
      >
        <Icon name="eraser" className="h-4 w-4" />
      </button>

      <span className="mx-0.5 h-6 w-px bg-track" aria-hidden="true" />

      {/* 색상 */}
      {PALETTE.map((p, i) => {
        const value = values[i]
        const active = tool === 'pen' && !!value && color === value
        return (
          <button
            key={p.key}
            ref={(el) => {
              swatchRefs.current[i] = el
            }}
            type="button"
            aria-label={`${p.label} 펜`}
            aria-pressed={active}
            onClick={() => value && onColor(value)}
            data-active={active}
            className={cn(
              'h-7 w-7 rounded-full border-2 border-track transition-transform hover:scale-110 data-[active=true]:ring-2 data-[active=true]:ring-primary data-[active=true]:ring-offset-2',
              p.swatch,
            )}
          />
        )
      })}

      <span className="mx-0.5 h-6 w-px bg-track" aria-hidden="true" />

      {/* 굵기 */}
      {WIDTHS.map((w) => (
        <button
          key={w.value}
          type="button"
          onClick={() => onWidth(w.value)}
          aria-pressed={width === w.value}
          className={cn(
            'rounded-full px-2.5 py-1 text-[.75rem] font-bold transition-transform hover:scale-105',
            width === w.value ? 'bg-primary text-white' : 'bg-canvas text-ink-soft',
          )}
        >
          {w.label}
        </button>
      ))}

      <span className="mx-0.5 h-6 w-px bg-track" aria-hidden="true" />

      {/* 되돌리기 / 전체 지우기 */}
      <button
        type="button"
        aria-label="되돌리기"
        onClick={onUndo}
        disabled={!canUndo}
        className={cn(iconBtn, 'bg-canvas text-ink disabled:opacity-40')}
      >
        <Icon name="back" className="h-4 w-4" />
      </button>
      {/*
        학생에게는 "내가 그린 것 전부"다 — 칠판을 통째로 비우는 건 선생님만 할 수 있다
        (서버가 BOARD_CLEAR 를 교사 전용으로 막는다). 라벨로 그 차이를 정직하게 말한다.
      */}
      <button
        type="button"
        aria-label={canClearAll ? '칠판 전체 지우기' : '내가 그린 것 전부 지우기'}
        onClick={onClear}
        disabled={!canClear}
        className={cn(iconBtn, 'bg-danger-soft text-danger disabled:opacity-40')}
      >
        <Icon name="trash" className="h-4 w-4" />
      </button>
    </div>
  )
}
