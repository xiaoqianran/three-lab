import type RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

/** 62 m/s 在 1/60 秒的子步里要前进 1.03 米 —— 远大于墙厚 */
const SPEED = 62
const WALL_THICKNESS = 0.14

const shots: RAPIER.RigidBody[] = []
let timer = 0

export const ccdHall: Hall = {
  id: '11-ccd',
  title: 'CCD 高速穿透',
  desc: `两颗一模一样的子弹以 ${SPEED} m/s 打向同一面 ${WALL_THICKNESS} 米厚的墙。绿色那颗开了 CCD（连续碰撞检测），会正常弹开；红色那颗没开 —— 一个物理子步它要走 1 米出头，早就跨过整面墙了，于是直接穿过去。`,
  tags: ['CCD', 'swept collision', 'tunneling', 'thin wall'],

  camera: { radius: 24, theta: 0.8, phi: 0.98, target: [0, 5, 0] },

  build(ctx) {
    const { stage } = ctx

    shots.length = 0
    timer = 1.2

    stage.addGround(70)
    // 四周加围墙：开 CCD 的子弹会从墙上弹回来，没有墙它会一路飞到天边
    stage.addArena(56, 9)

    // 薄墙
    stage.spawn({
      shape: { kind: 'box', size: [1.5, 5.5, WALL_THICKNESS] },
      position: [0, 3.6, 0],
      kind: 'fixed',
      color: '#2f3a52',
    })

    // 两个炮口
    stage.spawn({
      shape: { kind: 'box', size: [1.6, 1.6, 1.6] },
      position: [-11, 5.4, 0],
      kind: 'fixed',
      color: '#2b6b4a',
    })
    stage.spawn({
      shape: { kind: 'box', size: [1.6, 1.6, 1.6] },
      position: [-11, 2.2, 0],
      kind: 'fixed',
      color: '#6b2b34',
    })

    // 接弹板，让穿过去的子弹能留下痕迹
    stage.spawn({
      shape: { kind: 'box', size: [0.5, 8, 6] },
      position: [14, 4, 0],
      kind: 'fixed',
      color: '#3a4360',
    })
  },

  update(dt, _elapsed, ctx) {
    // 每帧都清理跑远的子弹。不开 CCD 的那颗会连着穿透墙、接弹板和围墙，
    // 不清理的话它会一直飞到坐标十万米外，既难看又白占刚体槽位。
    for (let i = shots.length - 1; i >= 0; i--) {
      const t = shots[i].translation()
      if (Math.abs(t.x) > 45 || Math.abs(t.z) > 45 || t.y < -10) {
        ctx.stage.remove(shots[i])
        shots.splice(i, 1)
      }
    }

    timer -= dt
    if (timer > 0) return
    timer = 1.3

    const fire = (y: number, ccd: boolean, color: string) => {
      const body = ctx.stage.spawn({
        shape: { kind: 'ball', radius: 0.22 },
        position: [-11.8, y, 0],
        color,
        density: 9,
        restitution: 0.6,
        friction: 0.4,
        ccd,
        noSleep: true,
      })

      body.setLinvel({ x: SPEED, y: 0, z: 0 }, true)
      shots.push(body)
    }

    fire(5.4, true, '#6bcb77')
    fire(2.2, false, '#ff6b6b')

    while (shots.length > 16) {
      const old = shots.shift()
      if (old) ctx.stage.remove(old)
    }
  },
}
