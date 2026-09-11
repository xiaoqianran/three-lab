import * as THREE from 'three'
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'

export type UpdateFn = (dt: number, elapsed: number) => void
export type ResizeFn = (width: number, height: number) => void
/** 完全接管一次渲染（想做分屏、镜面、多相机的时候用） */
export type RenderFn = (dt: number) => void

const DEFAULT_CLEAR_COLOR = 0x0b0e16
const DEFAULT_EXPOSURE = 1.1

/**
 * 渲染引擎外壳：渲染器 / 场景 / 相机 / 主循环。
 *
 * 试验场的原则是"薄"：这里是唯一一处会写渲染器设置的地方，
 * 试验代码只管往场景里放东西，不碰底层。
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  /** 后处理链：null 时走普通的 renderer.render */
  composer: EffectComposer | null = null
  /** 非 null 时由它接管渲染 */
  renderOverride: RenderFn | null = null

  private readonly clock = new THREE.Clock()
  private readonly updaters: UpdateFn[] = []
  private readonly resizers: ResizeFn[] = []
  private readonly afterRenderHooks: Array<() => void> = []
  private rafId = 0
  private running = false

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)

    // 光照在线性空间算，最后转 sRGB 输出；这两行写错画面不是发灰就是过曝
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = DEFAULT_EXPOSURE
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setClearColor(DEFAULT_CLEAR_COLOR, 1)

    // 一帧里可能渲染多次（阴影贴图、后处理、镜面反射），
    // 所以关掉自动清零，改成一帧结束时手动 reset —— 这样统计才是整帧的总量
    this.renderer.info.autoReset = false

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000)
    this.camera.position.set(0, 6, 12)

    window.addEventListener('resize', this.handleResize)
  }

  onUpdate(fn: UpdateFn): void {
    this.updaters.push(fn)
  }

  onResize(fn: ResizeFn): void {
    this.resizers.push(fn)
  }

  /** 渲染完成之后触发。读 renderer.info 的统计要放这里，否则数字是残缺的 */
  onAfterRender(fn: () => void): void {
    this.afterRenderHooks.push(fn)
  }

  get width(): number {
    return window.innerWidth
  }

  get height(): number {
    return window.innerHeight
  }

  get pixelRatio(): number {
    return this.renderer.getPixelRatio()
  }

  /** 把试验临时改过的全局状态还原成出厂设置（切试验时调用） */
  resetSceneState(): void {
    this.scene.background = null
    this.scene.environment = null
    this.scene.fog = null
    this.scene.overrideMaterial = null

    this.renderer.setClearColor(DEFAULT_CLEAR_COLOR, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = DEFAULT_EXPOSURE
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
    this.renderer.autoClear = true
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
  }

  private handleResize = (): void => {
    const width = window.innerWidth
    const height = window.innerHeight

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height, false)
    this.composer?.setSize(width, height)

    // 宽高比变了必须重算投影矩阵，否则画面会拉伸
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()

    for (const fn of this.resizers) fn(width, height)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.clock.start()

    const loop = (): void => {
      this.rafId = requestAnimationFrame(loop)

      // 切标签页回来时 delta 会很大，钳制一下免得物体瞬移
      const dt = Math.min(this.clock.getDelta(), 1 / 20)
      const elapsed = this.clock.elapsedTime

      for (const fn of this.updaters) fn(dt, elapsed)

      if (this.renderOverride) this.renderOverride(dt)
      else if (this.composer) this.composer.render(dt)
      else this.renderer.render(this.scene, this.camera)

      for (const fn of this.afterRenderHooks) fn()
      this.renderer.info.reset()
    }

    loop()
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('resize', this.handleResize)
    this.renderer.dispose()
  }
}
