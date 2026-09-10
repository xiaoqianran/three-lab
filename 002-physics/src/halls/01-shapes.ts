import type { ShapeSpec } from '../core/Stage'
import type { Hall, HallContext } from './types'

const SHAPES: Array<{ shape: ShapeSpec; color: string }> = [
  { shape: { kind: 'ball', radius: 0.68 }, color: '#ff6b6b' },
  { shape: { kind: 'box', size: [1.2, 1.2, 1.2] }, color: '#ffd93d' },
  { shape: { kind: 'capsule', radius: 0.48, height: 1.75 }, color: '#6bcb77' },
  { shape: { kind: 'cylinder', radius: 0.62, height: 1.55 }, color: '#4d96ff' },
  { shape: { kind: 'cone', radius: 0.68, height: 1.6 }, color: '#c77dff' },
  { shape: { kind: 'roundBox', size: [1.28, 1.28, 1.28], radius: 0.38 }, color: '#ff9f68' },
]

/** 一个随机点集，用来演示凸包 */
function randomHullPoints(count: number, radius: number): Float32Array {
  const points = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // 在球内取点：开三次方才能得到体积均匀分布
    const u = Math.random() * 2 - 1
    const phi = Math.random() * Math.PI * 2
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    const r = radius * Math.cbrt(Math.random())

    points[i * 3] = Math.cos(phi) * s * r
    points[i * 3 + 1] = u * r
    points[i * 3 + 2] = Math.sin(phi) * s * r
  }
  return points
}

let dropTimer = 0
let dropIndex = 0

export const shapesHall: Hall = {
  id: '01-shapes',
  title: '形状陈列馆',
  desc: '把 Rapier 支持的所有凸形状各来一个，从同一块斜坡上放下去。球的纯滚动、方块的滑动摩擦、圆柱的轴向选择、圆锥的绕圈打转、圆角盒的顿挫 —— 碰撞体形状直接决定了运动会是什么样。',
  tags: ['ball', 'cuboid', 'capsule', 'cylinder', 'cone', 'roundCuboid', 'convexHull'],

  // 斜坡沿 x 方向倾斜，所以机位要偏向 z 轴才能看到侧剖面；
  // theta 太小又会让两个展示台重叠，0.42 是折中。
  // 加了挡边之后物体不会再散出去，机位可以收近。
  camera: { radius: 25, theta: 0.5, phi: 0.95, target: [1.8, 3, 0] },

  build({ stage }) {
    stage.addGround(80)
    // 围栏。这个展厅的横向散开是**固有**的：圆柱在斜面上会拐弯、圆锥会绕圈，
    // 不可能靠调参让它们走直线。围栏收紧到 ±12，让它们散得有限度、也还在画面里。
    stage.addArena(24, 4)

    dropTimer = 0
    dropIndex = 0

    // 斜坡：绕 z 轴负向旋转 => 左高右低。尺寸收小，别让它占满整个画面
    const tilt = 0.34
    const half = tilt / 2
    stage.spawn({
      shape: { kind: 'box', size: [13, 0.5, 9] },
      position: [-0.5, 2.6, 0],
      rotation: [0, 0, -Math.sin(half), Math.cos(half)],
      kind: 'fixed',
      friction: 0.6,
      restitution: 0.04,
      color: '#39456b',
    })

    // 坡底的挡边。
    // 斜坡倾角 19.5°，物体滑到底时还有七八米每秒，在平地上会一路滚到
    // 四十米外、滚出地面边缘掉进虚空。
    // 长度必须够：物体弹跳后会横向散开，11 米长的挡边它们会从两端绕过去。
    stage.spawn({
      shape: { kind: 'box', size: [0.6, 1.8, 24] },
      position: [7.8, 0.9, 0],
      kind: 'fixed',
      friction: 0.9,
      restitution: 0.05,
      color: '#4a5570',
    })

    // 六种形状各占一条道，避免互相碰撞看不清
    SHAPES.forEach(({ shape, color }, i) => {
      stage.spawn({
        shape,
        // 起始高度贴着坡面（坡面在 x=-5.4 处约 y=4.5）。
        // 原来放在 6.2，一块 1.4 米的形状要下落 1.7 米才碰到坡面，
        // 砸下来直接弹到隔壁赛道，整条坡道全乱。
        position: [-5.4, 5.3 + i * 0.16, -3.6 + i * 1.45],
        color,
        friction: 0.72,
        restitution: 0.25,
        linearDamping: 0.02,
        angularDamping: 0.05,
      })
    })

    // 静态展示台：两个凸包，一个对比用的方盒。
    // 必须放在挡边**后面**（x=11.5）—— 原来在 x=6.2，正好卡在滚道上，
    // 滑下来的物体撞上去就被弹到侧面，绕过挡边飞出去。
    stage.spawn({
      shape: { kind: 'convex', id: 'hull-a', points: randomHullPoints(28, 1) },
      position: [11.5, 1.1, -2.8],
      color: '#7ee0d0',
      kind: 'fixed',
    })
    stage.spawn({
      shape: { kind: 'convex', id: 'hull-b', points: randomHullPoints(64, 1) },
      position: [11.5, 1.1, 0],
      color: '#9c8bff',
      kind: 'fixed',
    })
    stage.spawn({
      shape: { kind: 'box', size: [2, 2, 2] },
      position: [11.5, 1, 2.8],
      color: '#5c6584',
      kind: 'fixed',
    })
  },

  update(dt, _elapsed, ctx: HallContext) {
    // 每几秒从坡顶补一个新形状，保持画面一直有东西在动
    dropTimer -= dt
    if (dropTimer > 0) return
    dropTimer = 2.6

    const pick = SHAPES[dropIndex++ % SHAPES.length]
    ctx.stage.spawn({
      shape: pick.shape,
      position: [-6.2 + Math.random() * 1.2, 5.6, -3.4 + Math.random() * 6.8],
      color: pick.color,
      friction: 0.72,
      restitution: 0.25,
      linearDamping: 0.02,
      angularDamping: 0.05,
    })
  },
}
