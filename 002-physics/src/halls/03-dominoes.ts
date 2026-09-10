import type RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

const COUNT = 180

/**
 * 圈数直接决定骨牌间距，而间距是连锁能不能传下去的唯一关键。
 *
 * 整条螺旋的弧长 ≈ TURNS × 2π × 平均半径(13)。
 * 3 圈时弧长 245 米，180 张牌平均间距 1.36 米 —— 牌高只有 1.5 米，
 * 倒下的牌刚好够到下一张的最底部，力臂约等于零，连锁走两张就断。
 * 2 圈时弧长 163 米，间距 0.91 米，正好落在"牌高 0.6~0.75 倍"的可靠区间。
 */
const TURNS = 2

let firstBody: RAPIER.RigidBody | null = null
let secondBody: RAPIER.RigidBody | null = null
let tipTimer = 0
let tipped = false

export const dominoesHall: Hall = {
  id: '03-dominoes',
  title: '多米诺螺旋',
  desc: '180 张骨牌排成三圈螺旋，每张的朝向都对齐切线方向 —— 这样倒下时才能精确地推倒下一张。进入展厅 1.5 秒后自动推倒第一张，然后看它自己走完一整圈。',
  tags: ['box colliders', 'impulse', 'restitution', 'shape orientation'],

  camera: { radius: 34, theta: 0.5, phi: 0.95, target: [0, 1.5, 0] },

  build({ stage }) {
    stage.addGround(80)

    firstBody = null
    secondBody = null
    tipTimer = 1.5
    tipped = false

    for (let i = 0; i < COUNT; i++) {
      const t = i / COUNT
      const angle = t * Math.PI * 2 * TURNS
      const radius = 19 - t * 12
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius

      // 局部 x 轴要对齐切线方向 (-sin, 0, cos)，解出偏航角
      const yaw = -(angle + Math.PI / 2)

      const body = stage.spawn({
        shape: { kind: 'box', size: [0.16, 1.5, 0.82] },
        position: [x, 0.75, z],
        rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
        // 恢复系数必须为 0，否则骨牌会弹回来把连锁打断
        friction: 0.62,
        restitution: 0,
        density: 0.9,
        linearDamping: 0.05,
        angularDamping: 0.06,
        color: i % 2 === 0 ? '#e8ecff' : '#8fa4ff',
      })

      if (i === 0) firstBody = body
      if (i === 1) secondBody = body
    }
  },

  update(dt) {
    if (tipped || !firstBody || !secondBody) return

    tipTimer -= dt
    if (tipTimer > 0) return

    tipped = true

    // 冲量必须按质量缩放。之前写死 9 N·s，而一张骨牌只有 0.18 kg
    // —— 那相当于给它 50 m/s 的初速，直接当场飞出太阳系。
    const mass = firstBody.mass()
    const impulse = mass * 1.2

    // 推倒方向直接由"前两张牌的实际位置"算出来。
    // 硬编码 angle = 0 推导出的切线只在当前这组螺旋参数下才是对的，
    // 以后改圈数或半径就会推反方向，连锁一张都传不出去。
    const from = firstBody.translation()
    const to = secondBody.translation()
    const dx = to.x - from.x
    const dz = to.z - from.z
    const length = Math.hypot(dx, dz) || 1

    // 打在牌面顶端而不是质心：力臂最大，一推就倒，也不会把它推平
    firstBody.applyImpulseAtPoint(
      { x: (dx / length) * impulse, y: 0, z: (dz / length) * impulse },
      { x: from.x, y: from.y + 0.62, z: from.z },
      true,
    )
  },
}
