import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

const GATE_IDLE = '#1f2a3d'
const GATE_HIT = '#6bcb77'
const HIT_DURATION = 0.55

let gate: RAPIER.RigidBody | null = null
let gateHandle = -1
let gateLight: THREE.PointLight | null = null

let hitTimer = 0
let spawnTimer = 0
let lit = false

export const sensorHall: Hall = {
  id: '12-sensors',
  title: '传感器与事件',
  desc: '整个门框是一块 sensor 碰撞体：它完全不参与接触求解，球会毫无阻碍地穿过去 —— 但物理引擎照样会为「进入」和「离开」各发一次事件。触发瞬间门框变色并发光，靠的就是这串事件。',
  tags: ['sensor collider', 'EventQueue', 'trigger volume', 'no contact response'],

  camera: { radius: 22, theta: 0.75, phi: 1.0, target: [0, 5, 0] },

  build(ctx) {
    const { stage, scene, physics } = ctx

    hitTimer = 0
    spawnTimer = 1
    lit = false

    stage.addGround(60)

    gate = stage.spawn({
      shape: { kind: 'box', size: [9, 2.6, 5] },
      position: [0, 5, 0],
      kind: 'fixed',
      sensor: true,
      color: GATE_IDLE,
    })

    // 事件里拿到的是 collider 的 handle，先记下来
    gateHandle = gate.collider(0).handle

    gateLight = new THREE.PointLight(0x6bcb77, 0, 18, 2)
    gateLight.position.set(0, 5, 0)
    scene.add(gateLight)

    // 传感器不产生接触，所以只能靠事件回调知道"有人进来了"
    physics.onCollision((h1, h2, started) => {
      if (!started) return
      if (h1 !== gateHandle && h2 !== gateHandle) return
      hitTimer = HIT_DURATION
    })
  },

  update(dt, _elapsed, ctx) {
    spawnTimer -= dt
    if (spawnTimer <= 0) {
      spawnTimer = 0.45

      ctx.stage.spawn({
        shape: { kind: 'ball', radius: 0.3 + Math.random() * 0.28 },
        position: [(Math.random() - 0.5) * 6, 15, (Math.random() - 0.5) * 3],
        color: Math.random() > 0.5 ? '#ffd93d' : '#c9d4ff',
        density: 1.6,
        restitution: 0.42,
        friction: 0.5,
        // 从 15 米高落下来末速不小，开 CCD 免得穿过门框地面
        ccd: true,
      })
    }

    // 只在状态翻转时改颜色，避免每帧重传整个实例颜色缓冲
    const shouldLight = hitTimer > 0

    if (shouldLight) {
      hitTimer -= dt
      if (!lit) {
        lit = true
        if (gate) ctx.stage.setColor(gate, GATE_HIT)
      }
      if (gateLight) gateLight.intensity = 16 * (hitTimer / HIT_DURATION)
    } else if (lit) {
      lit = false
      if (gate) ctx.stage.setColor(gate, GATE_IDLE)
      if (gateLight) gateLight.intensity = 0
    }
  },

  dispose({ scene }) {
    if (gateLight) scene.remove(gateLight)
    gateLight = null
    gate = null
    gateHandle = -1
    lit = false
  },
}
