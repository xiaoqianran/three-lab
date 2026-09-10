import RAPIER from '@dimforge/rapier3d-compat'

export type CollisionHandler = (handleA: number, handleB: number, started: boolean) => void

/**
 * Rapier 世界封装。
 *
 * 只做两件渲染循环必须关心的事：
 *   1. 固定步长累加器 —— 物理必须定步长才有确定性，渲染帧率是可变的
 *   2. 碰撞事件转发 —— Rapier 的事件要先 drain 出来，否则队列会一直涨
 */
export class PhysicsWorld {
  world: RAPIER.World
  /** 物理固定步长（秒） */
  readonly fixedDt = 1 / 60

  paused = false
  /** 关掉重力的开关（面板里用） */
  gravityScale = 1

  private readonly baseGravity: { x: number; y: number; z: number }
  private eventQueue: RAPIER.EventQueue
  private readonly handlers: CollisionHandler[] = []
  private accumulator = 0
  private stepsLastFrame = 0

  private constructor(world: RAPIER.World, gravity: { x: number; y: number; z: number }) {
    this.world = world
    this.baseGravity = gravity
    this.eventQueue = new RAPIER.EventQueue(true)
  }

  /** RAPIER 是 WASM，必须先 await init() 才能构造任何东西 */
  static async create(gravityY = -9.81): Promise<PhysicsWorld> {
    await RAPIER.init()
    const gravity = { x: 0, y: gravityY, z: 0 }

    const instance = new PhysicsWorld(new RAPIER.World(gravity), gravity)
    instance.applySolverQuality()
    return instance
  }

  /**
   * 默认求解器只跑 4 次迭代，对"上百个刚体互相压着"的堆叠场景明显不够
   * —— 塔会像果冻一样自己抖散。砖块越多的展厅越依赖这个值。
   */
  private applySolverQuality(): void {
    this.world.integrationParameters.numSolverIterations = 20
  }

  /**
   * 创建关节，并**默认关闭两端刚体之间的碰撞**。
   *
   * 这一步不能省：被关节拴在一起的两个刚体，在连接点附近几何必然重叠
   * ——摆球套在摆杆末端、布娃娃的关节藏在相邻两段里面、车轮嵌进车身。
   * 如果还让它们参与碰撞，求解器就会一边被关节拉着靠近、一边被碰撞推着分开，
   * 两股约束互相打架，物体会被直接甩出几十米每秒。
   *
   * 所有展厅都必须走这个入口，不要直接调 world.createImpulseJoint。
   */
  createJoint(
    data: RAPIER.JointData,
    bodyA: RAPIER.RigidBody,
    bodyB: RAPIER.RigidBody,
    wakeUp = true,
  ): RAPIER.ImpulseJoint {
    const joint = this.world.createImpulseJoint(data, bodyA, bodyB, wakeUp)
    joint.setContactsEnabled(false)
    return joint
  }

  onCollision(fn: CollisionHandler): void {
    this.handlers.push(fn)
  }

  clearCollisionHandlers(): void {
    this.handlers.length = 0
  }

  get steps(): number {
    return this.stepsLastFrame
  }

  get bodyCount(): number {
    return this.world.bodies.len()
  }

  setGravityScale(scale: number): void {
    this.gravityScale = scale
    this.world.gravity = {
      x: this.baseGravity.x * scale,
      y: this.baseGravity.y * scale,
      z: this.baseGravity.z * scale,
    }
  }

  /** 推进物理；返回这一帧实际跑了几个子步 */
  step(dt: number): number {
    this.stepsLastFrame = 0
    if (this.paused) return 0

    this.accumulator += Math.min(dt, 0.25)

    let steps = 0
    // 最多追 4 个子步：卡顿之后如果疯狂补步，反而会雪崩
    while (this.accumulator >= this.fixedDt && steps < 4) {
      this.world.step(this.eventQueue)

      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        for (const fn of this.handlers) fn(h1, h2, started)
      })

      this.accumulator -= this.fixedDt
      steps++
    }

    if (steps >= 4) this.accumulator = 0

    this.stepsLastFrame = steps
    return steps
  }

  /**
   * 彻底重建物理世界。
   *
   * 不用"遍历所有刚体逐个删除"那套 —— 实测它会在 WASM 侧触发借用冲突
   * （`recursive use of an object ... unsafe aliasing in rust`），而且残留的
   * joint / collider 很容易漏。直接把整个 World free 掉重建，最干净也最快。
   *
   * 注意：调用前必须先让 Stage 放弃所有 body 引用（Stage.clear）。
   */
  reset(): void {
    this.world.free()
    this.world = new RAPIER.World(this.baseGravity)
    this.applySolverQuality()

    this.eventQueue.free()
    this.eventQueue = new RAPIER.EventQueue(true)

    this.accumulator = 0
    this.stepsLastFrame = 0
  }
}
