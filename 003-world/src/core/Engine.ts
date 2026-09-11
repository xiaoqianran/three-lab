import * as THREE from 'three'
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'

export type UpdateFn = (dt: number, elapsed: number) => void
export type ResizeFn = (width: number, height: number) => void
/** 完全接管一次渲染（第 05 章的双视口分屏用它） */
export type RenderFn = (dt: number) => void

/** 出厂设置：章节临时改过的全局状态，切章时要能一键还原 */
const DEFAULT_CLEAR_COLOR = 0x0a0e18
const DEFAULT_EXPOSURE = 1.1

/**
 * 渲染引擎外壳：渲染器 / 场景 / 相机 / 主循环。
 *
 * 这一层故意做得极薄 —— 里面每一行都能对应到一个 three.js 的 API，
 * 读它就等于在读 three.js 最核心的用法。
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  /** 后处理链。平时是 null，第 14 章挂上之后主循环改走 composer.render() */
  composer: EffectComposer | null = null
  /** 非 null 时由它负责渲染，默认的单次 renderer.render 被跳过 */
  renderOverride: RenderFn | null = null

  private readonly clock = new THREE.Clock()
  private readonly updaters: UpdateFn[] = []
  private readonly resizers: ResizeFn[] = []
  private readonly afterRenderHooks: Array<() => void> = []
  /** 分辨率倍率，第 17 章的自适应画质用它 */
  private pixelRatioScale = 1
  private rafId = 0
  private running = false

  constructor(canvas: HTMLCanvasElement) {
    // ---- 渲染器：真正干活的那位，把「场景 + 相机」翻译成屏幕上的像素 ----
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    // 设备像素比封顶 2：4K 屏上再往上堆分辨率，帧率掉得比画质提升快得多
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)

    // 颜色空间：光照计算在「线性空间」里做，最后才转成 sRGB 输出。
    // 这两行写错，画面要么发灰要么过曝，是最常见的"看着不对"的原因。
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = DEFAULT_EXPOSURE

    // 阴影：本质是"从灯光视角再渲染一遍深度图"，先开着，
    // 具体哪盏灯投影由灯光自己的 castShadow 决定。
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setClearColor(DEFAULT_CLEAR_COLOR, 1)

    // info.autoReset 默认是 true —— 每调用一次 renderer.render() 就把统计清零。
    // 但一帧里可能渲染好几次（阴影贴图、后处理、镜面反射都会再渲染一遍），
    // 那样统计到的数字就只剩最后一次，看不出真实开销。
    // 关掉自动清零，改成一帧开始时手动 reset()，数字才代表"这一帧一共画了多少"。
    this.renderer.info.autoReset = false

    // ---- 场景：一棵 Object3D 树，所有能画的东西都必须挂在它下面 ----
    this.scene = new THREE.Scene()

    // ---- 相机：决定"从哪看、看多远" ----
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    )
    this.camera.position.set(0, 6, 12)

    window.addEventListener('resize', this.handleResize)
  }

  onUpdate(fn: UpdateFn): void {
    this.updaters.push(fn)
  }

  onResize(fn: ResizeFn): void {
    this.resizers.push(fn)
  }

  /**
   * 渲染完成之后触发。
   * renderer.info 的统计只有在"整帧画完"这一刻才是完整的，
   * 所以读绘制批次这类数字要放在这个钩子里，而不是每帧更新里。
   */
  onAfterRender(fn: () => void): void {
    this.afterRenderHooks.push(fn)
  }

  get width(): number {
    return window.innerWidth
  }

  get height(): number {
    return window.innerHeight
  }

  /** 分辨率倍率：小于 1 = 降采样换帧率（第 17 章） */
  setPixelRatioScale(scale: number): void {
    this.pixelRatioScale = THREE.MathUtils.clamp(scale, 0.4, 2)
    this.applySize()
  }

  get currentPixelRatio(): number {
    return this.renderer.getPixelRatio()
  }

  private applySize(): void {
    const w = window.innerWidth
    const h = window.innerHeight

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.pixelRatioScale)
    this.renderer.setSize(w, h, false)
    // 后处理链的缓冲区要跟着一起改，否则画面会被拉伸
    this.composer?.setSize(w, h)
  }

  private handleResize = (): void => {
    this.applySize()

    // 相机宽高比变了，必须重算投影矩阵，否则画面会变形
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()

    for (const fn of this.resizers) fn(window.innerWidth, window.innerHeight)
  }

  /**
   * 把「某一章临时改过的全局状态」恢复成出厂设置。
   * 切章时由 World 调用 —— 否则第 15 章的天空盒会一直留在第 16 章里。
   */
  resetSceneState(): void {
    this.scene.background = null
    this.scene.environment = null
    this.scene.fog = null
    // overrideMaterial 会让整个场景都用同一个材质渲染，调试用，别忘了还原
    this.scene.overrideMaterial = null

    this.renderer.setClearColor(DEFAULT_CLEAR_COLOR, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = DEFAULT_EXPOSURE
    // 阴影贴图类型改了之后材质需要重新编译，还原成默认值最保险
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // 第 05 章用视口/裁剪区做分屏，用完必须关掉
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight)
    this.renderer.autoClear = true

    this.setPixelRatioScale(1)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.clock.start()

    const loop = (): void => {
      this.rafId = requestAnimationFrame(loop)

      // 切标签页回来时 getDelta() 会给一个很大的值，钳制一下避免物体瞬移
      const dt = Math.min(this.clock.getDelta(), 1 / 20)
      const elapsed = this.clock.elapsedTime

      for (const fn of this.updaters) fn(dt, elapsed)

      if (this.renderOverride) this.renderOverride(dt)
      else if (this.composer) this.composer.render(dt)
      else this.renderer.render(this.scene, this.camera)

      for (const fn of this.afterRenderHooks) fn()

      // 统计在"下一帧开始前"清零：这样整帧画完之后，
      // info 里就留着这一帧的完整总量（含阴影贴图、后处理、镜面反射等多次渲染）
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
