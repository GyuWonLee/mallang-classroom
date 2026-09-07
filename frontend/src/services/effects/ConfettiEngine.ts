/**
 * ConfettiEngine — Canvas 폭죽 애니메이션만 책임진다. (ref 폭죽 로직 이관)
 * 순수 TS. 캔버스 엘리먼트를 주입받아 동작하며 React 의존성 없음.
 */

type Shape = 'star' | 'triangle' | 'ring' | 'rect'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rot: number
  vr: number
  life: number
  shape: Shape
}

const COLORS = ['#EF4444', '#FACC15', '#3B82F6', '#22C55E', '#A855F7']

export class ConfettiEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private particles: Particle[] = []
  private running = false
  private reduceMotion: boolean
  private handleResize = () => this.sizeCanvas()

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없어요')
    this.ctx = ctx
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.sizeCanvas()
    addEventListener('resize', this.handleResize)
  }

  dispose(): void {
    removeEventListener('resize', this.handleResize)
    this.particles = []
    this.running = false
  }

  private sizeCanvas(): void {
    this.canvas.width = innerWidth * devicePixelRatio
    this.canvas.height = innerHeight * devicePixelRatio
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  }

  private pickShape(): Shape {
    const r = Math.random()
    if (r < 0.2) return 'star'
    if (r < 0.45) return 'triangle'
    if (r < 0.6) return 'ring'
    return 'rect'
  }

  private makeParticle(x: number, y: number, spread: number, baseAngle = -Math.PI / 2): Particle {
    const angle = baseAngle + (Math.random() - 0.5) * spread
    const speed = 10 + Math.random() * 12
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 10 + Math.random() * 11,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      life: 110 + Math.random() * 60,
      shape: this.pickShape(),
    }
  }

  /** 정답 시: 양쪽 아래에서 화면 안쪽으로 교차 폭발 */
  burst(count: number): void {
    if (this.reduceMotion) return
    const half = Math.round(count / 2)
    for (let i = 0; i < half; i++)
      this.particles.push(
        this.makeParticle(innerWidth * 0.03, innerHeight * 0.9, 1.3, -Math.PI / 2 + 0.55),
      )
    for (let i = 0; i < half; i++)
      this.particles.push(
        this.makeParticle(innerWidth * 0.97, innerHeight * 0.9, 1.3, -Math.PI / 2 - 0.55),
      )
    this.run()
  }

  /** 완료 축하 시: 위에서 비처럼 시간차로 흩뿌림 */
  rain(): void {
    if (this.reduceMotion) return
    const total = 130
    const batches = 22
    const perBatch = Math.ceil(total / batches)
    for (let b = 0; b < batches; b++) {
      setTimeout(() => {
        for (let i = 0; i < perBatch; i++) {
          const p = this.makeParticle(Math.random() * innerWidth, -20 - Math.random() * 200, 1)
          p.vy = 1.5 + Math.random() * 4
          p.vx = (Math.random() - 0.5) * 3
          p.life = 170 + Math.random() * 90
          this.particles.push(p)
        }
        this.run()
      }, b * 90)
    }
  }

  private drawStar(p: Particle): void {
    const c = this.ctx
    c.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
      c.lineTo(Math.cos(a) * p.size * 0.7, Math.sin(a) * p.size * 0.7)
    }
    c.closePath()
    c.fill()
  }

  private drawTriangle(p: Particle): void {
    const c = this.ctx
    const r = p.size * 0.62
    c.beginPath()
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3 - Math.PI / 2
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    c.closePath()
    c.fill()
  }

  private drawRing(p: Particle): void {
    const c = this.ctx
    c.beginPath()
    c.arc(0, 0, p.size * 0.42, 0, Math.PI * 2)
    c.lineWidth = p.size * 0.22
    c.strokeStyle = c.fillStyle
    c.stroke()
  }

  private run(): void {
    if (this.running) return
    this.running = true
    const c = this.ctx
    const frame = () => {
      c.clearRect(0, 0, innerWidth, innerHeight)
      this.particles = this.particles.filter((p) => p.life > 0 && p.y < innerHeight + 40)
      for (const p of this.particles) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.25
        p.vx *= 0.99
        p.rot += p.vr
        p.life--
        c.save()
        c.translate(p.x, p.y)
        c.rotate(p.rot)
        c.globalAlpha = Math.min(1, p.life / 40)
        c.fillStyle = p.color
        if (p.shape === 'star') this.drawStar(p)
        else if (p.shape === 'triangle') this.drawTriangle(p)
        else if (p.shape === 'ring') this.drawRing(p)
        else c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62)
        c.restore()
      }
      if (this.particles.length) requestAnimationFrame(frame)
      else {
        this.running = false
        c.clearRect(0, 0, innerWidth, innerHeight)
      }
    }
    frame()
  }
}
