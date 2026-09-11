import * as THREE from 'three'

type Pointer = { x: number; y: number }

/**
 * 阻尼轨道相机：自己实现而不是用 OrbitControls，是为了让每一行都能读懂。
 *
 * 核心思路只有一句：相机位置 = 观察目标 + 球坐标偏移。
 * 鼠标拖拽改的是球坐标的方位角 / 俯仰角，滚轮改半径，每帧用指数插值追上去，
 * 于是就有了"阻尼感"，而且过渡时间与帧率无关。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera

  minRadius = 0.5
  maxRadius = 400
  minPhi = 0.04
  maxPhi = Math.PI - 0.04
  damping = 5

  /** 关掉它，就能把左键让给 TransformControls 之类的控件（第 13 章） */
  enabled = true
  /** 自动绕圈，看静态模型时很有用 */
  autoRotate = false
  autoRotateSpeed = 0.12

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

  /** 当前观察目标（只读引用，改它等于直接改相机看向哪里） */
  get lookAt(): THREE.Vector3 {
    return this.target
  }

  /** 平滑移动到指定机位（切章时用）。半径 / 方位角 / 俯仰角都是球坐标 */
  setPose(radius: number, theta: number, phi: number, target?: [number, number, number]): void {
    this.goal.radius = THREE.MathUtils.clamp(radius, this.minRadius, this.maxRadius)
    this.goal.theta = theta
    this.goal.phi = THREE.MathUtils.clamp(phi, this.minPhi, this.maxPhi)
    if (target) this.goalTarget.set(target[0], target[1], target[2])
    else this.goalTarget.set(0, 0, 0)
  }

  update(dt: number): void {
    if (this.autoRotate) this.goal.theta += dt * this.autoRotateSpeed

    this.goal.radius = THREE.MathUtils.clamp(this.goal.radius, this.minRadius, this.maxRadius)
    this.goal.phi = THREE.MathUtils.clamp(this.goal.phi, this.minPhi, this.maxPhi)

    // 指数阻尼：t 只取决于这一帧过了多久，跟帧率无关
    const t = 1 - Math.exp(-this.damping * dt)

    this.spherical.radius = THREE.MathUtils.lerp(this.spherical.radius, this.goal.radius, t)
    this.spherical.theta = THREE.MathUtils.lerp(this.spherical.theta, this.goal.theta, t)
    this.spherical.phi = THREE.MathUtils.lerp(this.spherical.phi, this.goal.phi, t)
    this.target.lerp(this.goalTarget, t)
    this.spherical.makeSafe()

    // Spherical -> Vector3，再加上观察目标，就是相机的位置
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
      // 两指捏合缩放
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
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinchStart > 0) {
        this.goal.radius = this.pinchStartRadius * (this.pinchStart / Math.max(dist, 1))
      }
      return
    }

    if (this.panning) {
      // 右键 = 沿相机自己的横轴 / 纵轴平移观察目标
      const scale = this.spherical.radius * 0.0016
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1)
      this.goalTarget.addScaledVector(right, -dx * scale)
      this.goalTarget.addScaledVector(up, dy * scale)
      return
    }

    // 左键 = 绕目标旋转：拖得越远转得越快（固定灵敏度，手感更稳）
    this.autoRotate = false
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

    // 乘法缩放：远处的物体步子大，近处步子小，符合直觉
    const normalized = THREE.MathUtils.clamp(e.deltaY, -120, 120) / 120
    this.goal.radius *= Math.exp(normalized * 0.22)
  }

  private onContextMenu = (e: Event): void => {
    // 右键留给平移，屏蔽浏览器菜单
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
