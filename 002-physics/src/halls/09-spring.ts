import RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

interface SpringConfig {
  stiffness: number
  damping: number
  rest: number
  color: string
  label: string
}

/**
 * 从左到右刚度递增，最后一个是几乎无阻尼的。
 * spring joint 不是刚体约束，而是一个软约束 —— 它允许两端无限接近或远离，
 * 只是施加与伸长量成正比的力。
 */
const SPRINGS: SpringConfig[] = [
  { stiffness: 6, damping: 0.4, rest: 3.2, color: '#6bcb77', label: '软' },
  { stiffness: 18, damping: 0.4, rest: 3.2, color: '#4d96ff', label: '中' },
  { stiffness: 60, damping: 0.5, rest: 3.2, color: '#c77dff', label: '硬' },
  { stiffness: 18, damping: 0.02, rest: 3.2, color: '#ff8f5e', label: '无阻尼' },
]

let weights: RAPIER.RigidBody[] = []
let kickTimer = 0
let kickIndex = 0

export const springHall: Hall = {
  id: '09-spring',
  title: '弹簧与悬挂',
  desc: '同一套配重挂在四个刚度不同的弹簧上。软弹簧拉得很长、频率低；硬弹簧几乎不动。最右边那个把阻尼调到接近 0 —— 它会一直荡下去，因为没有任何东西消耗它的能量。',
  tags: ['spring joint', 'stiffness', 'damping', 'oscillation'],

  camera: { radius: 24, theta: 0.85, phi: 1.0, target: [0, 7, 0] },

  build(ctx) {
    const { stage, physics } = ctx

    stage.addGround(70)

    weights = []

    SPRINGS.forEach((cfg, i) => {
      const x = (i - (SPRINGS.length - 1) / 2) * 5

      const anchor = stage.spawn({
        shape: { kind: 'box', size: [0.6, 0.4, 0.6] },
        position: [x, 11, 0],
        kind: 'fixed',
        color: '#4a5570',
      })

      // 悬挂点的世界位置 = 锚块底面
      const hangY = 11 - 0.2
      const weight = stage.spawn({
        shape: { kind: 'ball', radius: 0.55 },
        position: [x, hangY - cfg.rest, 0],
        color: cfg.color,
        density: 3,
        // 弹簧永远在动，不能让刚体睡着
        noSleep: true,
        linearDamping: 0,
        angularDamping: 0,
      })

      physics.createJoint(
        RAPIER.JointData.spring(
          cfg.rest,
          cfg.stiffness,
          cfg.damping,
          { x: 0, y: -0.2, z: 0 },
          { x: 0, y: 0, z: 0 },
        ),
        anchor,
        weight,
        true,
      )

      weights.push(weight)
    })
  },

  update(dt, _elapsed, _ctx) {
    // 每隔一会儿给其中一个配重一个侧向冲量，看它怎么回弹
    kickTimer -= dt
    if (kickTimer > 0) return

    kickTimer = 2.4

    const target = weights[kickIndex++ % weights.length]
    if (!target) return

    target.applyImpulse({ x: 14, y: 0, z: 0 }, true)
  },
}
