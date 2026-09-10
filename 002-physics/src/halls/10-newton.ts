import RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

const COUNT = 5
const LENGTH = 3.2
const RADIUS = 0.55

/** 最左边那颗球，用来周期性重新拉动 —— 牛顿摆摩擦消耗得很快 */
let driveBall: RAPIER.RigidBody | null = null
let kickTimer = 0

export const newtonHall: Hall = {
  id: '10-newton',
  title: '牛顿摆',
  desc: '五个等长的摆球几乎挨在一起。拉起最左边那个松手，动量会一路传过去把最右边那个顶飞 —— 全程没有弹簧、没有脚本，只是球形碰撞体在求解器里一次次的瞬时接触。',
  tags: ['ball colliders', 'restitution 0.97', 'impulse transfer', 'contact solver'],

  camera: { radius: 17, theta: 0.6, phi: 1.12, target: [0, 7.5, 0] },

  build(ctx) {
    const { stage, physics } = ctx
    const world = physics.world

    stage.addGround(60)

    const span = COUNT * RADIUS * 2 + 1.4

    // 顶梁：所有摆杆都挂在它上面
    const beam = stage.spawn({
      shape: { kind: 'box', size: [span, 0.3, 0.9] },
      position: [0, 10, 0],
      kind: 'fixed',
      color: '#4a5570',
    })

    // 球之间只留 4 毫米，太少会互相穿插，太多动量传不过去
    const gap = RADIUS * 2 + 0.004
    const pivotY = 9.85

    for (let i = 0; i < COUNT; i++) {
      const x = (i - (COUNT - 1) / 2) * gap

      const rod = stage.spawn({
        shape: { kind: 'capsule', radius: 0.04, height: LENGTH },
        position: [x, pivotY - LENGTH / 2, 0],
        color: '#8fa4ff',
        density: 0.5,
        // 摆要荡很久，阻尼必须很小
        angularDamping: 0.004,
      })

      const ball = stage.spawn({
        shape: { kind: 'ball', radius: RADIUS },
        position: [x, pivotY - LENGTH, 0],
        color: '#ffd93d',
        density: 12,
        restitution: 0.97,
        friction: 0.2,
      })

      // 杆顶挂到横梁（锚点用世界 x —— 横梁中心在原点，所以正好就是相对坐标）
      physics.createJoint(
        RAPIER.JointData.spherical({ x, y: -0.15, z: 0 }, { x: 0, y: LENGTH / 2, z: 0 }),
        beam,
        rod,
        true,
      )

      // 杆底与球焊死
      physics.createJoint(
        RAPIER.JointData.fixed(
          { x: 0, y: -LENGTH / 2, z: 0 },
          { x: 0, y: 0, z: 0, w: 1 },
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
        rod,
        ball,
        true,
      )

      // 拉起最左边那颗
      if (i === 0) {
        driveBall = ball
        ball.setLinvel({ x: 7.5, y: 0, z: 0 }, true)
      }
    }

    kickTimer = 6
  },

  update(dt) {
    // 牛顿摆的动能会被接触和阻尼一点点吃掉，停稳之后画面就没内容了。
    // 所以每隔几秒检测一次，静止了就重新把最左边那颗拉起来放一次。
    if (!driveBall) return

    kickTimer -= dt
    if (kickTimer > 0) return

    kickTimer = 6

    const v = driveBall.linvel()
    if (Math.hypot(v.x, v.y, v.z) > 0.6) return

    driveBall.setLinvel({ x: 7.5, y: 0, z: 0 }, true)
  },
}
