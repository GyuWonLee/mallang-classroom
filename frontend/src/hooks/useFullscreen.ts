import { useCallback, useEffect, type RefObject } from 'react'
import { useClassroomStore } from '@/stores/useClassroomStore'

interface FullscreenDoc extends Document {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void>
}
interface FullscreenEl extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>
}

function getFullscreenElement(): Element | null {
  const d = document as FullscreenDoc
  return document.fullscreenElement || d.webkitFullscreenElement || null
}

/** 화상 카드 전체 화면 토글 (ref 전체화면 로직 이관, 표준 + webkit 접두사 대응) */
export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const setFullscreen = useClassroomStore((s) => s.setFullscreen)

  const toggle = useCallback(() => {
    const el = targetRef.current as FullscreenEl | null
    if (!el) return
    if (!getFullscreenElement()) {
      const req = el.requestFullscreen?.bind(el) || el.webkitRequestFullscreen?.bind(el)
      req?.().catch(() => {})
    } else {
      const d = document as FullscreenDoc
      const exit = document.exitFullscreen?.bind(document) || d.webkitExitFullscreen?.bind(d)
      exit?.()
    }
  }, [targetRef])

  useEffect(() => {
    const onChange = () => setFullscreen(getFullscreenElement() === targetRef.current)
    const events = ['fullscreenchange', 'webkitfullscreenchange']
    events.forEach((e) => document.addEventListener(e, onChange))
    return () => events.forEach((e) => document.removeEventListener(e, onChange))
  }, [setFullscreen, targetRef])

  return { toggle }
}
