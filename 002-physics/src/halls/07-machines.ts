import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

const SEGMENTS = 3
// createImpulseJoint 的静态类型是基类 ImpulseJoint，但马达相关方法只在
// RevoluteImpulseJoint 这些子类上 —— 需要显式收窄
const joints: RAPIER.RevoluteImpulseJoint[] = []

export const machineHall: Hall = {
  id: '07-machines',
  title: '马达机械臂',
  desc: '三段臂用 revolute 关节串起来，每个关节配一个速度马达并限位 ±135°。马达不是"直接设角度"，而是施加有限力矩去逼近目标转速 —— setMotorMaxForce 就是它推不推得动的上限。',
  tags: ['revolute', 'motor', 'joint limits', 'max force'],

  camera: { radius: 19, theta: 0.65, phi: 1.05, target: [1.5, 3, 0] },

  build(ctx) {
    const { stage, physics } = ctx

    stage.addGround(70)
    joints.length = 0

    const base = stage.spawn({
      shape: { kind: 'cylinder', radius: 0.8, height: 0.5 },
      position: [0, 0.25, 0],
      kind: 'fixed',
      color: '#4a5570',
    })

    let previous: RAPIER.RigidBody = base
    // 关节在"上一段"上的锚点，第一段接在底座顶面
    let previousAnchor = new THREE.Vector3(0, 0.35, 0)
    // 当前连接点的世界坐标
    const cursor = new THREE.Vector3(0, 0.6, 0)

    for (let i = 0; i < SEGMENTS; i++) {
      const length = 2.6 - i * 0.55
      const center = cursor.clone().add(new THREE.Vector3(length / 2, 0, 0))

      const segment = stage.spawn({
        shape: { kind: 'box', size: [length, 0.3, 0.3] },
        position: [center.x, center.y, center.z],
        color: i === SEGMENTS - 1 ? '#ffd93d' : '#8fa4ff',
        density: 0.9,
        friction: 0.6,
        restitution: 0.1,
        angularDamping: 0.12,
        // 马达要持续对抗重力，不能被休眠掉
        noSleep: true,
      })

      const joint = physics.createJoint(
        RAPIER.JointData.revolute(
          { x: previousAnchor.x, y: previousAnchor.y, z: previousAnchor.z },
          { x: -length / 2, y: 0, z: 0 },
          // 绕 z 轴转 => 手臂在竖直平面内摆动
          { x: 0, y: 0, z: 1 },
        ),
        previous,
        segment,
        true,
      ) as RAPIER.RevoluteImpulseJoint

      // 限位收到 ±78°。原来给 ±135°，关节能一路转到底，
      // 三节全部折回来叠在底座上，看起来就是"手臂瘫了"。
      joint.setLimits(-Math.PI * 0.43, Math.PI * 0.43)
      joint.setMotorMaxForce(8000)
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased)
      // 用**位置**马达而不是速度马达。
      // 速度马达会一直朝一个方向推，直到撞上限位卡住；
      // 位置马达是"弹簧拉向目标角"，才能让手臂稳定地悬在某个姿态上。
      joint.configureMotorPosition(0, 900, 90)

      joints.push(joint)

      previous = segment
      previousAnchor = new THREE.Vector3(length / 2, 0, 0)
      cursor.copy(center).add(new THREE.Vector3(length / 2, 0, 0))
    }
  },

  update(dt, elapsed) {
    void dt

    // 每段的**目标角度**错开相位，整条臂就会像在招手。
    // 偏移 +0.55 是为了让目标角**始终为正**（绕 +Z 转正角 = 向上抬）：
    // 摆到负角时手臂会往下扎，指尖直接插进地板，看起来像断了一节。
    for (let i = 0; i < joints.length; i++) {
      const target = 0.55 + Math.sin(elapsed * 0.9 + i * 1.1) * 0.45
      joints[i].configureMotorPosition(target, 900, 90)
    }
  },
}
