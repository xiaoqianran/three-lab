import RAPIER from '@dimforge/rapier3d-compat'
import type { ShapeSpec } from '../core/Stage'
import type { Hall, HallContext } from './types'

type Vec3 = [number, number, number]

interface Part {
  name: string
  shape: ShapeSpec
  position: Vec3
  color: string
  density: number
  /** 父体名字 —— 没有就是自由漂浮的根 */
  parent?: string
  /** 关节在自己身上的锚点（相对自身中心） */
  selfAnchor?: Vec3
  /** 关节在父体上的锚点（相对父体中心） */
  parentAnchor?: Vec3
}

/**
 * 关节位置全部是手算出来的：让两边的锚点在**世界坐标**下重合，
 * 否则关节一创建就会把两个刚体猛地拉开，布娃娃当场散架。
 *
 * 躯干中心定在 y = 9，尺寸 capsule r=0.32 h=1.2（上下端在 8.4 / 9.6）。
 */
const PARTS: Part[] = [
  // ---- 躯干（根） ----
  {
    name: 'torso',
    shape: { kind: 'capsule', radius: 0.32, height: 1.2 },
    position: [0, 9, 0],
    color: '#7fb4ff',
    density: 1,
  },

  // ---- 头 ----
  {
    name: 'head',
    shape: { kind: 'ball', radius: 0.3 },
    position: [0, 9.9, 0],
    color: '#ffd9b0',
    density: 0.8,
    parent: 'torso',
    selfAnchor: [0, -0.3, 0],
    parentAnchor: [0, 0.6, 0],
  },
]

/** 左右两侧对称生成四肢 */
for (const side of [1, -1] as const) {
  const tag = side > 0 ? 'l' : 'r'

  PARTS.push(
    {
      name: `upperArm_${tag}`,
      shape: { kind: 'capsule', radius: 0.11, height: 0.7 },
      position: [0.34 * side, 9.1, 0],
      color: '#8fa4ff',
      density: 0.9,
      parent: 'torso',
      selfAnchor: [0, 0.35, 0],
      parentAnchor: [0.34 * side, 0.45, 0],
    },
    {
      name: `foreArm_${tag}`,
      shape: { kind: 'capsule', radius: 0.1, height: 0.65 },
      position: [0.34 * side, 8.425, 0],
      color: '#9db4ff',
      density: 0.8,
      parent: `upperArm_${tag}`,
      selfAnchor: [0, 0.325, 0],
      parentAnchor: [0, -0.35, 0],
    },
    {
      name: `thigh_${tag}`,
      shape: { kind: 'capsule', radius: 0.16, height: 0.9 },
      position: [0.2 * side, 7.95, 0],
      color: '#6b86d8',
      density: 1.1,
      parent: 'torso',
      selfAnchor: [0, 0.45, 0],
      parentAnchor: [0.2 * side, -0.6, 0],
    },
    {
      name: `shin_${tag}`,
      shape: { kind: 'capsule', radius: 0.13, height: 0.85 },
      position: [0.2 * side, 7.075, 0],
      color: '#7d96e6',
      density: 1,
      parent: `thigh_${tag}`,
      selfAnchor: [0, 0.425, 0],
      parentAnchor: [0, -0.45, 0],
    },
  )
}

export const ragdollHall: Hall = {
  id: '06-ragdoll',
  title: '布娃娃',
  desc: '10 段胶囊用 9 个球窝关节串成一个人形。spherical 允许任意方向旋转但不允许平移 —— 这正是人体关节的样子。从高空扔下来，看它怎么摔成一摊。',
  tags: ['spherical joints', 'articulated body', 'capsule colliders', 'damping'],

  camera: { radius: 16, theta: 0.75, phi: 1.15, target: [0, 6, 0] },

  build(ctx: HallContext) {
    ctx.stage.addGround(60)

    // 一圈矮墙，别让人摔出去
    ctx.stage.addArena(22, 3)

    const bodies = new Map<string, RAPIER.RigidBody>()

    for (const part of PARTS) {
      const body = ctx.stage.spawn({
        shape: part.shape,
        position: part.position,
        color: part.color,
        density: part.density,
        friction: 0.55,
        restitution: 0.06,
        // 高自由度链条没有阻尼会一直抖
        linearDamping: 0.15,
        angularDamping: 0.3,
      })

      bodies.set(part.name, body)

      if (!part.parent || !part.selfAnchor || !part.parentAnchor) continue

      const parent = bodies.get(part.parent)
      if (!parent) continue

      ctx.physics.createJoint(
        RAPIER.JointData.spherical(
          { x: part.parentAnchor[0], y: part.parentAnchor[1], z: part.parentAnchor[2] },
          { x: part.selfAnchor[0], y: part.selfAnchor[1], z: part.selfAnchor[2] },
        ),
        parent,
        body,
        true,
      )
    }
  },
}
