import * as THREE from 'three'

export type UpdateFn = (dt: number, elapsed: number) => void
export type ResizeFn = (width: number, height: number) => void

/**
 * 渲染引擎外壳：渲染器 / 场景 / 相机 / 主循环。
 * 物理世界不在这里 —— 它由 PhysicsWorld 单独管理，两者只在主循环里对齐。
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

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
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.25
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setClearColor(0x0e1219, 1)

    this.scene = new THREE.Scene()
    // 雾的颜色必须跟背景一致，否则远处物体会"浮"在一层灰上
    this.scene.fog = new THREE.Fog(0x0e1219, 90, 320)

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      700,
    )
    this.camera.position.set(0, 12, 26)

    this.setupLights()

    window.addEventListener('resize', this.handleResize)
  }

  private setupLights(): void {
    // 天空色给冷调、地面反射色给深蓝，这样暗面是蓝的不是黑的
    this.scene.add(new THREE.HemisphereLight(0x9cbcff, 0x2a3550, 0.95))

    // 实测 2.6 会把地面直接照爆，1.35 是"有立体感但不过曝"的区间
    const key = new THREE.DirectionalLight(0xfff2e0, 1.35)
    key.position.set(20, 30, 14)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 140
    key.shadow.camera.left = -45
    key.shadow.camera.right = 45
    key.shadow.camera.top = 45
    key.shadow.camera.bottom = -45
    // 阴影相机覆盖 90×90 米，每像素约 4cm，bias 太小会满屏自阴影噪点
    key.shadow.bias = -0.0016
    key.shadow.normalBias = 0.07
    // 光锥参数改完必须重算投影矩阵，否则阴影相机还是构造时的默认 10×10 范围
    key.shadow.camera.updateProjectionMatrix()
    this.scene.add(key)
    this.scene.add(key.target)

    // 冷色轮廓光，避免背光面死黑
    const rim = new THREE.DirectionalLight(0x6f8dff, 0.65)
    rim.position.set(-18, 12, -20)
    this.scene.add(rim)

    // 环境光兜底，保证背光面还能看清形状
    this.scene.add(new THREE.AmbientLight(0x38456b, 0.9))
  }

  onUpdate(fn: UpdateFn): void {
    this.updaters.push(fn)
  }

  onResize(fn: ResizeFn): void {
    this.resizers.push(fn)
  }

  onAfterRender(fn: () => void): void {
    this.afterRenderHooks.push(fn)
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

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h, false)

    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()

    for (const fn of this.resizers) fn(w, h)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.clock.start()

    const loop = (): void => {
      this.rafId = requestAnimationFrame(loop)

      // 切标签页回来时 delta 会很大，钳制一下，否则物体会瞬移
      const dt = Math.min(this.clock.getDelta(), 1 / 20)
      const elapsed = this.clock.elapsedTime

      for (const fn of this.updaters) fn(dt, elapsed)

      this.renderer.render(this.scene, this.camera)

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
