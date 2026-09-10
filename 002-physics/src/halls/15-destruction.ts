import type RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

const ROWS = 11
const COLS = 7
const BRICK_W = 1.5
const BRICK_H = 0.66
const BRICK_D = 0.72

const shells: RAPIER.RigidBody[] = []
let timer = 0

export const destructionHall: Hall = {
  id: '15-destruction',
  title: '破碎之墙',
  desc: '严格来说这不是"破碎" —— 是 77 块独立砖块在物理上被撞开。每块砖都是真实的刚体，所以墙体倒塌的形态每次都不一样：有时整片塌，有时只缺口，取决于炮弹打中的位置。',
  tags: ['many dynamic bodies', 'stacking', 'CCD shell', 'high mass ratio'],

  camera: { radius: 24, theta: 0.8, phi: 1.0, target: [0, 4, 0] },

  build(ctx) {
    const { stage } = ctx

    shells.length = 0
    timer = 2.2

    stage.addGround(80)
    stage.addArena(40, 14)

    // 交错砌砖：每隔一行错开半块，更像真墙，也更抗倒
    for (let row = 0; row < ROWS; row++) {
      const offset = (row % 2) * BRICK_W * 0.5

      for (let col = 0; col < COLS; col++) {
        const x = (col - (COLS - 1) / 2) * BRICK_W + offset
        const y = BRICK_H / 2 + row * BRICK_H * 1.02

        stage.spawn({
          shape: { kind: 'box', size: [BRICK_W * 0.95, BRICK_H * 0.95, BRICK_D] },
          position: [x, y, 0],
          color: row % 2 === 0 ? '#8a6a52' : '#a37e62',
          friction: 0.85,
          restitution: 0.04,
          density: 1.7,
        })
      }
    }
  },

  update(dt, _elapsed, ctx) {
    timer -= dt
    if (timer > 0) return
    timer = 3.4

    const shell = ctx.stage.spawn({
      shape: { kind: 'ball', radius: 0.55 },
      position: [-17, 3.6 + Math.random() * 3, (Math.random() - 0.5) * 1.2],
      color: '#ff4d6d',
      // 30 倍密度对 1.7 倍密度的砖，质量差要拉开才砸得动
      density: 30,
      restitution: 0.22,
      friction: 0.5,
      ccd: true,
      noSleep: true,
    })

    shell.setLinvel({ x: 36, y: 1.5, z: 0 }, true)
    shells.push(shell)

    while (shells.length > 4) {
      const old = shells.shift()
      if (old) ctx.stage.remove(old)
    }
  },
}
