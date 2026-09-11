import RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

/** 关节演示需要一个显眼的静态支架 */
function makeAnchor(ctx: Parameters<Hall['build']>[0], position: [number, number, number]) {
  return ctx.stage.spawn({
    shape: { kind: 'box', size: [0.6, 0.6, 0.6] },
    position,
    kind: 'fixed',
    color: '#4a5570',
  })
}

let prismaticSlider: RAPIER.RigidBody | null = null

export const jointsHall: Hall = {
  id: '05-joints',
  title: '关节总览',
  desc: '四种基础约束各搭一个：revolute 只允许绕一根轴转（摆锤）、prismatic 只允许沿一根轴滑（活塞）、spherical 允许任意方向转但不允许平移（球窝）、fixed 完全焊死（刚性拼装）。',
  tags: ['revolute', 'prismatic', 'spherical', 'fixed', 'impulse joints'],

  // 所有物体只占 x∈[-9,7]、y∈[1,12]，半径 30 会把它们缩成画面中间一小撮
  camera: { radius: 19, theta: 0.72, phi: 1.06, target: [-1, 5.6, 0] },

  build(ctx) {
    const { stage, physics } = ctx

    stage.addGround(70)
    prismaticSlider = null

    // ---------------- revolute：钟摆 ----------------
    // 支架锚点在 z+1.5，杆的锚点在 z-1.5，两根杆水平相接
    const pendulumAnchor = makeAnchor(ctx, [-9, 7.5, 0])
    const pendulum = stage.spawn({
      // 杆太细（0.18）在远处就只剩一个像素，看着像根线而不是摆杆
      shape: { kind: 'box', size: [0.32, 0.32, 3] },
      position: [-9, 7.5, 3],
      color: '#ff8f5e',
      density: 1.6,
      angularDamping: 0.02,
    })

    physics.createJoint(
      RAPIER.JointData.revolute(
        { x: 0, y: 0, z: 1.5 },
        { x: 0, y: 0, z: -1.5 },
        // 绕 x 轴旋转 => 杆在竖直平面内摆动
        { x: 1, y: 0, z: 0 },
      ),
      pendulumAnchor,
      pendulum,
      true,
    )

    // 给一点初速，让钟摆立刻动起来
    pendulum.setLinvel({ x: 0, y: 0, z: 5.5 }, true)

    // ---------------- prismatic：活塞 ----------------
    const rail = stage.spawn({
      shape: { kind: 'box', size: [0.42, 0.42, 8] },
      position: [-2, 7.5, 0],
      kind: 'fixed',
      color: '#4a5570',
    })

    const slider = stage.spawn({
      shape: { kind: 'box', size: [1.1, 1.1, 1.1] },
      position: [-2, 7.5, 0],
      color: '#6bcb77',
      density: 2,
      restitution: 0.4,
    })

    const piston = physics.createJoint(
      RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
      rail,
      slider,
      true,
    ) as RAPIER.PrismaticImpulseJoint

    // prismatic 默认没有行程限制，滑块会一路滑出导轨外悬在半空。
    // 导轨长 8、滑块宽 1.1，两端各留一点余量 → ±3.4。
    piston.setLimits(-3.4, 3.4)

    prismaticSlider = slider

    // ---------------- spherical：球窝摆 ----------------
    const ballAnchor = makeAnchor(ctx, [7, 8, 0])
    const ballRod = stage.spawn({
      shape: { kind: 'capsule', radius: 0.13, height: 2.6 },
      position: [7, 6.7, 0],
      color: '#8fa4ff',
      density: 1.2,
      angularDamping: 0.05,
    })

    physics.createJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 1.3, z: 0 }),
      ballAnchor,
      ballRod,
      true,
    )

    // 末端挂个重球，视觉上更像链球。
    // 位置必须让两个锚点在**世界坐标**下重合：杆的锚点在 y-1.3 处（世界 5.4），
    // 球的锚点是它的中心 —— 所以球心也得放在 5.4。差 0.3 米就够让关节
    // 在第一帧把所有误差一次性变成冲量，把球甩到 40 m/s。
    const bob = stage.spawn({
      shape: { kind: 'ball', radius: 0.42 },
      position: [7, 5.4, 0],
      color: '#c77dff',
      density: 4,
    })

    physics.createJoint(
      RAPIER.JointData.spherical({ x: 0, y: -1.3, z: 0 }, { x: 0, y: 0, z: 0 }),
      ballRod,
      bob,
      true,
    )

    ballRod.setLinvel({ x: 0, y: 0, z: 4 }, true)

    // ---------------- fixed：刚性拼装 ----------------
    const barA = stage.spawn({
      shape: { kind: 'box', size: [2.2, 0.28, 0.28] },
      position: [0, 11.5, 0],
      color: '#ffd93d',
      density: 1,
    })
    const barB = stage.spawn({
      shape: { kind: 'box', size: [0.28, 0.28, 2.2] },
      position: [1.1, 11.5, -1.1],
      color: '#ffd93d',
      density: 1,
    })

    physics.createJoint(
      RAPIER.JointData.fixed(
        { x: 1.1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 0, y: 0, z: 1.1 },
        { x: 0, y: 0, z: 0, w: 1 },
      ),
      barA,
      barB,
      true,
    )
  },

  update(_dt, elapsed) {
    // 活塞来回抽动：周期性改线速度，比马达更直观。
    // 用 hallElapsed 而不是 performance.now() —— 后者是页面级时钟，
    // 切回本展厅时相位会突然跳一下。
    if (!prismaticSlider) return
    prismaticSlider.setLinvel({ x: 0, y: 0, z: Math.sin(elapsed * 1.2) * 7 }, true)
  },
}
