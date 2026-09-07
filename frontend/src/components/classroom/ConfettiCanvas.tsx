import { useEffect, useRef } from 'react'
import { ConfettiEngine } from '@/services/effects/ConfettiEngine'
import { confettiController } from '@/services/effects/confettiController'

/** 전역 폭죽 캔버스. 엔진을 만들어 컨트롤러에 등록한다. */
export function ConfettiCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const engine = new ConfettiEngine(ref.current)
    confettiController.register(engine)
    return () => {
      confettiController.register(null)
      engine.dispose()
    }
  }, [])

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90]" />
}
