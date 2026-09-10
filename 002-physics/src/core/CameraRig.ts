import * as THREE from 'three'

type Pointer = { x: number; y: number }

/**
 * 阻尼轨道相机。
 * 左键旋转 / 滚轮缩放 / 右键平移观察目标。
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera

  minRadius = 2
  maxRadius = 200
  minPhi = 0.04
  maxPhi = Math.PI - 0.04
  damping = 5

  private readonly spherical = new THREE.Spherical(26, Math.PI * 0.42, 0.7)
  private readonly goal = new THREE.Spherical(26, Math.PI * 0.42, 0.7)
  private readonly target = new THREE.Vector3()
  private readonly goalTarget = new THREE.Vector3()
  private readonly pointers = new Map<number, Pointer>()
  private readonly offset = new THREE.Vector3()
  private readonly element: HTMLElement
  private pinchStart = 0
  private pinchStartRadius = 0
  private panning = false

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement, radius = 26) {
    this.camera = camera
    this.element = element

    this.spherical.radius = radius
    this.goal.radius = radius

    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerUp)
    element.addEventListener('wheel', this.onWheel, { passive: false })
    element.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** 平滑移动到指定机位（切换展厅时用） */
  setPose(radius: number, theta: number, phi: number, target?: [number, number, number]): void {
    this.goal.radius = radius
    this.goal.theta = theta
    this.goal.phi = phi
    if (target) this.goalTarget.set(target[0], target[1], target[2])
    else this.goalTarget.set(0, 0, 0)
  }

  update(dt: number): void {
    this.goal.radius = THREE.MathUtils.clamp(this.goal.radius, this.minRadius, this.maxRadius)
    this.goal.phi = THREE.MathUtils.clamp(this.goal.phi, this.minPhi, this.maxPhi)

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
      // 沿相机平面平移观察中心
      const scale = this.spherical.radius * 0.0016
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1)
      this.goalTarget.addScaledVector(right, -dx * scale)
      this.goalTarget.addScaledVector(up, dy * scale)
      return
    }

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
    e.preventDefault()
    const normalized = THREE.MathUtils.clamp(e.deltaY, -120, 120) / 120
    this.goal.radius *= Math.exp(normalized * 0.22)
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown)
    this.element.removeEventListener('pointermove', this.onPointerMove)
    this.element.removeEventListener('pointerup', this.onPointerUp)
    this.element.removeEventListener('pointercancel', this.onPointerUp)
    this.element.removeEventListener('wheel', this.onWheel)
  }
}
