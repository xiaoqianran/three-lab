import * as THREE from 'three'
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'

export type UpdateFn = (dt: number, elapsed: number) => void
export type ResizeFn = (width: number, height: number) => void

/**
 * 渲染引擎外壳：持有 renderer / scene / camera，
 * 负责尺寸、主循环与回调分发。后处理链由外部注入。
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  /** 由 main 注入；存在时优先走 composer 渲染 */
  composer: EffectComposer | null = null

  private readonly clock = new THREE.Clock()
  private readonly updaters: UpdateFn[] = []
  private readonly resizers: ResizeFn[] = []
  private readonly afterRenderHooks: Array<() => void> = []
  private readonly basePixelRatio = Math.min(window.devicePixelRatio, 2)
  private renderScale = 1
  private rafId = 0
  private running = false

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor(0x04050c, 1)

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(
      52,
      window.innerWidth / window.innerHeight,
      0.05,
      4000,
    )
    this.camera.position.set(0, 7, 14)

    window.addEventListener('resize', this.handleResize)
  }

  onUpdate(fn: UpdateFn): void {
    this.updaters.push(fn)
  }

  onResize(fn: ResizeFn): void {
    this.resizers.push(fn)
  }

  /** 每帧渲染完成之后触发，用于截图这类必须紧跟渲染的动作 */
  onAfterRender(fn: () => void): void {
    this.afterRenderHooks.push(fn)
  }

  private get dpr(): number {
    return Math.min(window.devicePixelRatio, 2)
  }

  /** 渲染分辨率缩放（0.4 ~ 1），自适应画质用它降采样换帧率 */
  setRenderScale(scale: number): void {
    const next = THREE.MathUtils.clamp(scale, 0.4, 1)
    if (Math.abs(next - this.renderScale) < 0.001) return

    this.renderScale = next

    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setPixelRatio(this.dpr * next)
    this.renderer.setSize(w, h, false)
    this.composer?.setSize(w, h)

    for (const fn of this.resizers) fn(w, h)
  }

  get pixelRatio(): number {
    return this.renderer.getPixelRatio()
  }

  get width(): number {
    return window.innerWidth
  }

  get height(): number {
    return window.innerHeight
  }

  private handleResize = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight

    this.renderer.setPixelRatio(this.dpr * this.renderScale)
    this.renderer.setSize(w, h, false)

    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()

    this.composer?.setSize(w, h)

    for (const fn of this.resizers) fn(w, h)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.clock.start()

    const loop = (): void => {
      this.rafId = requestAnimationFrame(loop)

      // 切标签页回来时 delta 会很大，钳制一下避免粒子瞬移
      const dt = Math.min(this.clock.getDelta(), 1 / 20)
      const elapsed = this.clock.elapsedTime

      for (const fn of this.updaters) fn(dt, elapsed)

      if (this.composer) this.composer.render(dt)
      else this.renderer.render(this.scene, this.camera)

      // 截图必须紧跟渲染，否则 drawingBuffer 已被清空
      for (const fn of this.afterRenderHooks) fn()
    }

    loop()
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('resize', this.handleResize)
    this.renderer.dispose()
  }
}
