import {
  INITIAL_STATE,
  STAGE_KEYS,
  TOUR_STEPS,
  accumulateTo,
  type StageState,
  type TourStep,
} from './steps'

export interface TourHooks {
  /** 切换到某一步时触发，用于更新说明卡片 */
  onStep(index: number, step: TourStep): void
  /** 演示彻底结束（过渡收敛后或首次跳过时） */
  onFinish(): void
  /** 每步的相机预设 */
  setCamera(radius: number, theta: number, phi: number): void
  /** 每帧把插值后的权重应用到场景 */
  apply(state: StageState, spinPhase: number, animTime: number): void
}

/** 判定"已经逼近目标"的阈值 */
const SETTLE_EPSILON = 0.004

/**
 * 演示控制器。
 *
 * 职责只有三件：
 *   1. 维护"当前权重"并向"目标权重"做指数阻尼逼近（产生演化动画）
 *   2. 推进旋转相位与动画时间
 *   3. 自动播放 / 手动跳转的步进逻辑
 *
 * 它不碰任何 three.js 对象，所有落地动作通过 hooks 交给 main.ts。
 */
export class Tour {
  private readonly state: StageState = { ...INITIAL_STATE }
  private target: StageState = { ...INITIAL_STATE }

  private index = 0
  private elapsed = 0
  private spinPhase = 0
  private animTime = 0

  private active = false
  private finishing = false
  private _playing = true

  /** 权重逼近速度，越大过渡越快 */
  blendRate = 2.6

  constructor(private readonly hooks: TourHooks) {}

  get currentIndex(): number {
    return this.index
  }

  get total(): number {
    return TOUR_STEPS.length
  }

  get playing(): boolean {
    return this._playing
  }

  get isActive(): boolean {
    return this.active
  }

  /** 当前步的停留进度 0~1，用于进度条 */
  get progress(): number {
    const step = TOUR_STEPS[this.index]
    if (!step || step.duration <= 0) return 1
    return Math.min(1, this.elapsed / step.duration)
  }

  /** 从第一步开始播放 */
  start(): void {
    this.active = true
    this.finishing = false
    this._playing = true
    this.goto(0)
  }

  goto(index: number): void {
    const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, index))
    this.index = clamped
    this.elapsed = 0
    this.finishing = false
    this.target = accumulateTo(clamped)

    const step = TOUR_STEPS[clamped]
    this.hooks.setCamera(step.camera.radius, step.camera.theta, step.camera.phi)
    this.hooks.onStep(clamped, step)
  }

  next(): void {
    if (this.index >= TOUR_STEPS.length - 1) {
      this.finish()
      return
    }
    this.goto(this.index + 1)
  }

  prev(): void {
    if (this.index > 0) this.goto(this.index - 1)
  }

  togglePlay(): void {
    if (this.finishing) return
    this._playing = !this._playing
  }

  /**
   * 跳到结尾并交还控制权。
   * 不直接拍到位，而是让权重继续演化到终点后再收尾 ——
   * 否则中途按 Esc 会把画面停在半成品状态。
   */
  finish(): void {
    if (!this.active || this.finishing) return

    this.index = TOUR_STEPS.length - 1
    this.elapsed = 0
    this._playing = false
    this.finishing = true
    this.target = accumulateTo(this.index)
    this.hooks.onStep(this.index, TOUR_STEPS[this.index])
  }

  update(dt: number): void {
    if (!this.active) return

    // 与帧率无关的指数阻尼
    const t = 1 - Math.exp(-this.blendRate * dt)
    for (const key of STAGE_KEYS) {
      this.state[key] += (this.target[key] - this.state[key]) * t
    }

    this.animTime += dt
    // 旋转相位单独累积：这样 spin 权重归零时画面能真正停住，
    // 而不是因为时间还在走而"跳"到某个角度。
    // reverse 由 0 过渡到 1 时方向系数从 +1 平滑滑到 -1，中途自然经过静止。
    this.spinPhase += dt * this.state.spin * (1 - 2 * this.state.reverse)

    this.hooks.apply(this.state, this.spinPhase, this.animTime)

    if (this.finishing) {
      if (this.hasSettled()) {
        this.active = false
        this.finishing = false
        this.hooks.onFinish()
      }
      return
    }

    if (!this._playing) return

    this.elapsed += dt
    if (this.elapsed < TOUR_STEPS[this.index].duration) return

    // 最后一步停留结束后自动收尾，把界面交还给用户
    if (this.index < TOUR_STEPS.length - 1) this.next()
    else this.finish()
  }

  private hasSettled(): boolean {
    for (const key of STAGE_KEYS) {
      if (Math.abs(this.state[key] - this.target[key]) > SETTLE_EPSILON) return false
    }
    return true
  }
}
