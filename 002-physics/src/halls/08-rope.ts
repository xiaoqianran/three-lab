import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

const LINKS = 44
const LINK_LEN = 0.26

export const ropeHall: Hall = {
  id: '08-rope',
  title: '绳索与链条',
  desc: '44 节胶囊首尾用球窝关节串成一根软绳，末端吊着 8 倍密度的配重。每一节都是真正的刚体，所以它会自己打结、缠在柱子上、卡在方块上 —— 这是 rope joint（只约束两点距离）永远做不出来的效果。',
  tags: ['spherical chain', '44 joints', 'self-collision', 'solver stability'],

  camera: { radius: 24, theta: 1.0, phi: 1.02, target: [0, 6.5, 0] },

  build(ctx) {
    const { stage, physics } = ctx
    const world = physics.world

    stage.addGround(70)

    const anchor = stage.spawn({
      shape: { kind: 'box', size: [0.55, 0.4, 0.55] },
      position: [0, 14, 0],
      kind: 'fixed',
      color: '#4a5570',
    })

    // 柱子必须**放在绳子垂线之外**。
    // 之前放在 x=0，链节起始位置正好嵌在柱体内部 —— 固定体把它往外一推，
    // 整根绳子当场被弹到 16 m/s，看着就像抽筋。
    // 现在放在侧面，靠摆动甩过去缠上。
    stage.spawn({
      shape: { kind: 'cylinder', radius: 0.8, height: 16 },
      position: [3.4, 8, 0],
      kind: 'fixed',
      color: '#6bcb77',
    })
    stage.spawn({
      shape: { kind: 'box', size: [1.4, 1.4, 1.4] },
      position: [-3.2, 1, 0],
      kind: 'fixed',
      color: '#ff9f68',
    })

    let previous: RAPIER.RigidBody = anchor
    // 关节在"上一节"上的锚点，首节接在锚块底面
    let previousAnchor: [number, number, number] = [0, -0.2, 0]
    // 当前连接点的世界坐标
    const cursor = new THREE.Vector3(0, 13.8, 0)

    for (let i = 0; i < LINKS; i++) {
      const center = cursor.clone().add(new THREE.Vector3(0, -LINK_LEN / 2, 0))

      const link = stage.spawn({
        shape: { kind: 'capsule', radius: 0.075, height: LINK_LEN },
        position: [center.x, center.y, center.z],
        color: i % 4 === 0 ? '#ffd93d' : '#c9d4ff',
        density: 1.8,
        friction: 0.45,
        restitution: 0.02,
        // 44 节链条不压阻尼会一直抖
        linearDamping: 0.08,
        angularDamping: 0.1,
      })

      physics.createJoint(
        RAPIER.JointData.spherical(
          { x: previousAnchor[0], y: previousAnchor[1], z: previousAnchor[2] },
          { x: 0, y: LINK_LEN / 2, z: 0 },
        ),
        previous,
        link,
        true,
      )

      previous = link
      previousAnchor = [0, -LINK_LEN / 2, 0]
      cursor.copy(center).add(new THREE.Vector3(0, -LINK_LEN / 2, 0))
    }

    const weight = stage.spawn({
      shape: { kind: 'ball', radius: 0.45 },
      position: [cursor.x, cursor.y - 0.5, cursor.z],
      color: '#ff4d6d',
      density: 8,
    })

    physics.createJoint(
      RAPIER.JointData.spherical(
        { x: previousAnchor[0], y: previousAnchor[1], z: previousAnchor[2] },
        { x: 0, y: 0, z: 0 },
      ),
      previous,
      weight,
      true,
    )

    // 给配重一个侧向初速，让绳子荡起来撞上柱子
    weight.setLinvel({ x: 5.5, y: 0, z: 0 }, true)
  },
}
