import * as THREE from 'three'

type Pointer = { x: number; y: number }

/**
 * 轨道相机（精简版）。
 *
 * 只有一句话的原理：相机位置 = 观察目标 + 球坐标偏移。
 * 拖拽改方位角 theta / 俯仰角 phi，滚轮改半径 radius，右键拖拽平移目标，
 * 每帧用指数插值追上去 —— 这就是手感自然的"阻尼"。
 */
export class Orbit {
  readonly camera: THREE.PerspectiveCamera

  minRadius = 0.5
  maxRadius = 400
  minPhi = 0.04
  maxPhi = Math.PI - 0.04
  damping = 5
  /** 关掉它就能把左键让给别的交互（比如自己写的拖拽） */
  enabled = true

  private readonly spherical = new THREE.Spherical(18, Math.PI * 0.42, 0.7)
  private readonly goal = new THREE.Spherical(18, Math.PI * 0.42, 0.7)
  private readonly target = new THREE.Vector3()
  private readonly goalTarget = new THREE.Vector3()
  private readonly pointers = new Map<number, Pointer>()
  private readonly offset = new THREE.Vector3()
  private readonly element: HTMLElement
  private pinchStart = 0
  private pinchStartRadius = 0
  private panning = false

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement, radius = 18) {
    this.camera = camera
    this.element = element

    this.spherical.radius = radius
    this.goal.radius = radius

    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerUp)
    element.addEventListener('wheel', this.onWheel, { passive: false })
    element.addEventListener('contextmenu', this.onContextMenu)
  }

  /** 当前观察目标（只读引用） */
  get lookAt(): THREE.Vector3 {
    return this.target
  }

  /** 平滑移动到指定机位：半径 / 方位角 / 俯仰角 / 观察目标 */
  setPose(radius: number, theta: number, phi: number, target?: [number, number, number]): void {
    this.goal.radius = THREE.MathUtils.clamp(radius, this.minRadius, this.maxRadius)
    this.goal.theta = theta
    this.goal.phi = THREE.MathUtils.clamp(phi, this.minPhi, this.maxPhi)
    if (target) this.goalTarget.set(target[0], target[1], target[2])
    else this.goalTarget.set(0, 0, 0)
  }

  update(dt: number): void {
    this.goal.radius = THREE.MathUtils.clamp(this.goal.radius, this.minRadius, this.maxRadius)
    this.goal.phi = THREE.MathUtils.clamp(this.goal.phi, this.minPhi, this.maxPhi)

    // 与帧率无关的指数阻尼
    const t = 1 - Math.exp(-this.damping * dt)

    this.spherical.radius = THREE.MathUtils.lerp(this.spherical.radius, this.goal.radius, t)
    this.spherical.theta = THREE.MathUtils.lerp(this.spherical.theta, this.goal.theta, t)
    this.spherical.phi = THREE.MathUtils.lerp(this.spherical.phi, this.goal.phi, t)
    this.target.lerp(this.goalTarget, t)
    this.spherical.makeSafe()

    this.offset.setFromSpherical(this.spherical)
    this.camera.position.copy(this.target).add(this.offset)
    this.camera.lookAt(this.target)
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return

    this.element.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.panning = e.button === 2

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()]
      this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
      this.pinchStartRadius = this.goal.radius
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return

    const prev = this.pointers.get(e.pointerId)
    if (!prev) return

    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    prev.x = e.clientX
    prev.y = e.clientY

    if (this.pointers.size === 2) {
      // 两指捏合缩放
      const [a, b] = [...this.pointers.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinchStart > 0) {
        this.goal.radius = this.pinchStartRadius * (this.pinchStart / Math.max(distance, 1))
      }
      return
    }

    if (this.panning) {
      // 右键沿相机自己的横轴 / 纵轴平移观察目标
      const scale = this.spherical.radius * 0.0016
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1)
      this.goalTarget.addScaledVector(right, -dx * scale)
      this.goalTarget.addScaledVector(up, dy * scale)
      return
    }

    // 左键绕目标旋转
    const speed = 0.0045
    this.goal.theta -= dx * speed
    this.goal.phi -= dy * speed
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) this.pinchStart = 0
    if (this.pointers.size === 0) this.panning = false
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return
    e.preventDefault()

    // 乘法缩放：远处步子大、近处步子小
    const normalized = THREE.MathUtils.clamp(e.deltaY, -120, 120) / 120
    this.goal.radius *= Math.exp(normalized * 0.22)
  }

  private onContextMenu = (e: Event): void => {
    // 右键留给平移
    e.preventDefault()
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerup', this.onPointerUp)
    this.element.removeEventListener('pointercancel', this.onPointerUp)
    this.element.removeEventListener('wheel', this.onWheel)
    this.element.removeEventListener('contextmenu', this.onContextMenu)
  }
}
