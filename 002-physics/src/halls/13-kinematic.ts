import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

let lift: RAPIER.RigidBody | null = null
let rotor: RAPIER.RigidBody | null = null
let pusher: RAPIER.RigidBody | null = null

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const rotation = new THREE.Quaternion()

export const kinematicHall: Hall = {
  id: '13-kinematic',
  title: '运动学平台',
  desc: 'kinematic 刚体既不受重力、也不会被撞动 —— 它的位置完全由代码说了算。可它照样能把上面的箱子推着走、拽着走。三个平台各用一种驱动：上下电梯、旋转转盘、来回推板。',
  tags: ['kinematicPositionBased', 'setNextKinematicTranslation', 'friction drag'],

  camera: { radius: 30, theta: 0.7, phi: 0.96, target: [0, 4, 0] },

  build(ctx) {
    const { stage } = ctx
    stage.addGround(80)

    // ---------------- 电梯 ----------------
    lift = stage.spawn({
      shape: { kind: 'box', size: [6, 0.4, 6] },
      position: [-11, 3, 0],
      kind: 'kinematicPosition',
      color: '#4d96ff',
    })

    for (let i = 0; i < 6; i++) {
      stage.spawn({
        shape: { kind: 'box', size: [0.9, 0.9, 0.9] },
        position: [-12.4 + (i % 3) * 1.4, 4.5 + Math.floor(i / 3) * 1.05, -0.9 + (i % 2) * 1.8],
        color: '#ffd93d',
        density: 1.5,
        friction: 0.95,
      })
    }

    // ---------------- 旋转转盘 ----------------
    rotor = stage.spawn({
      shape: { kind: 'cylinder', radius: 4.2, height: 0.5 },
      position: [11, 0.4, 0],
      kind: 'kinematicPosition',
      color: '#6bcb77',
    })

    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2
      stage.spawn({
        shape: { kind: 'box', size: [0.8, 0.8, 0.8] },
        position: [11 + Math.cos(angle) * 2.7, 1.35, Math.sin(angle) * 2.7],
        color: '#c9d4ff',
        density: 1.3,
        friction: 0.95,
      })
    }

    // ---------------- 来回推板 ----------------
    pusher = stage.spawn({
      shape: { kind: 'box', size: [0.6, 3.2, 7] },
      position: [0, 2, 0],
      kind: 'kinematicPosition',
      color: '#c77dff',
    })

    for (let i = 0; i < 5; i++) {
      stage.spawn({
        shape: { kind: 'box', size: [0.9, 1.6, 0.9] },
        position: [-3.4 + i * 1.7, 0.9, 0],
        color: '#ff9f68',
        density: 1.2,
        friction: 0.85,
      })
    }
  },

  update(_dt, elapsed) {
    if (lift) {
      lift.setNextKinematicTranslation({ x: -11, y: 2.6 + Math.sin(elapsed * 0.8) * 1.9, z: 0 })
    }

    if (rotor) {
      rotation.setFromAxisAngle(Y_AXIS, elapsed * 0.9)
      rotor.setNextKinematicRotation({
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        w: rotation.w,
      })
    }

    if (pusher) {
      // 位移范围控制在 ±4.5，别撞到两侧的电梯和转盘
      pusher.setNextKinematicTranslation({ x: Math.sin(elapsed * 0.7) * 4.5, y: 2, z: 0 })
    }
  },

  dispose() {
    lift = null
    rotor = null
    pusher = null
  },
}
