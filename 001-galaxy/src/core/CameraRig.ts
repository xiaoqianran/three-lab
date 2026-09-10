import * as THREE from 'three'

type Pointer = { x: number; y: number }

/**
 * 阻尼轨道相机。
 * 自己实现而不是用 OrbitControls，是为了让"自动巡游"能直接驱动球坐标，
 * 不被控件内部状态覆盖。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera

  minRadius = 0.8
  maxRadius = 90
  minPhi = 0.12
  maxPhi = Math.PI - 0.12
  damping = 4.5
  autopilot = false
  autopilotSpeed = 0.055

  private readonly spherical = new THREE.Spherical(16, Math.PI * 0.36, 0.6)
  private readonly goal = new THREE.Spherical(16, Math.PI * 0.36, 0.6)
  private readonly target = new THREE.Vector3(0, 0, 0)

  private readonly pointers = new Map<number, Pointer>()
  private readonly element: HTMLElement
  private pinchStart = 0
  private pinchStartRadius = 0
  private autoTime = 0
  private offset = new THREE.Vector3()

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement, initialRadius = 16) {
    this.camera = camera
    this.element = element
    this.spherical.radius = initialRadius
    this.goal.radius = initialRadius

    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerUp)
    element.addEventListener('wheel', this.onWheel, { passive: false })
  }

  /** 直接跳到某个视角（用于"复位"） */
  reset(radius = 16): void {
    this.goal.set(radius, Math.PI * 0.36, 0.6)
    this.spherical.copy(this.goal)
    this.target.set(0, 0, 0)
  }

  /**
   * 平滑移动到指定机位（不瞬移）。
   * 分步演示每步调一次，剩下的过渡交给每帧的阻尼插值。
   */
  setGoal(radius: number, theta: number, phi: number): void {
    this.autopilot = false
    this.goal.radius = THREE.MathUtils.clamp(radius, this.minRadius, this.maxRadius)
    this.goal.theta = theta
    this.goal.phi = THREE.MathUtils.clamp(phi, this.minPhi, this.maxPhi)
  }

  update(dt: number): void {
    this.autoTime += dt

    if (this.autopilot) {
      this.goal.theta += dt * this.autopilotSpeed

      // 俯仰在盘面上下缓慢摆动
      const sway = (Math.sin(this.autoTime * 0.11) + 1) * 0.5
      this.goal.phi = THREE.MathUtils.lerp(0.55, 1.35, sway)

      // 半径在近景与远景之间来回穿越粒子层
      const cruise = (Math.sin(this.autoTime * 0.075) + 1) * 0.5
      this.goal.radius = THREE.MathUtils.lerp(1.6, this.maxRadius * 0.72, cruise)
    }

    this.goal.radius = THREE.MathUtils.clamp(this.goal.radius, this.minRadius, this.maxRadius)
    this.goal.phi = THREE.MathUtils.clamp(this.goal.phi, this.minPhi, this.maxPhi)

    // 指数阻尼插值，与帧率无关
    const t = 1 - Math.exp(-this.damping * dt)

    this.spherical.radius = THREE.MathUtils.lerp(this.spherical.radius, this.goal.radius, t)
    this.spherical.theta = THREE.MathUtils.lerp(this.spherical.theta, this.goal.theta, t)
    this.spherical.phi = THREE.MathUtils.lerp(this.spherical.phi, this.goal.phi, t)
    this.spherical.makeSafe()

    this.offset.setFromSpherical(this.spherical)
    this.camera.position.copy(this.target).add(this.offset)
    this.camera.lookAt(this.target)
  }

  private onPointerDown = (e: PointerEvent): void => {
    // 右键留给"引力源"工具，不参与相机旋转
    if (e.button === 2) return

    this.element.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
      this.pinchStartRadius = this.goal.radius
      // 用户接管时退出巡游
      this.autopilot = false
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId)
    if (!prev) return

    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    prev.x = e.clientX
    prev.y = e.clientY

    if (this.pointers.size === 1) {
      this.autopilot = false
      const speed = 0.0042 * Math.min(2, this.camera.position.length() / 12 + 0.7)
      this.goal.theta -= dx * speed
      this.goal.phi -= dy * speed
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinchStart > 0) {
        this.goal.radius = this.pinchStartRadius * (this.pinchStart / Math.max(dist, 1))
      }
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchStart = 0
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.autopilot = false

    const normalized = THREE.MathUtils.clamp(e.deltaY, -120, 120) / 120
    // 乘法缩放：远处快、近处慢，手感更自然
    this.goal.radius *= Math.exp(normalized * 0.24)
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerup', this.onPointerUp)
    this.element.removeEventListener('pointercancel', this.onPointerUp)
    this.element.removeEventListener('wheel', this.onWheel)
  }
}
