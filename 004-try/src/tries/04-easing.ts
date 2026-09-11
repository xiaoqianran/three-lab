import * as THREE from 'three'
import { ease, label, lerp, mat, type EaseFn } from '../core/kit'
import type { Try } from './types'

/**
 * 04 · 自己写缓动
 *
 * 不做库：手写几个 easing 函数，让小球在同一段位移上走出完全不同的性格。
 * 缓动函数只是"输入进度 0~1，输出位置比例"的一个普通函数，
 * 输出**允许超出 0~1** —— backOut 的"冲过头再弹回来"就是这么来的。
 *
 * 一条轨道一个函数，错开出发时间，六条一起跑，差别一眼就能看出来。
 */

interface Lane {
  ball: THREE.Mesh
  ease: EaseFn
  /** 出发时间的错位，避免六条同时到达 */
  phase: number
}

const LANES: Array<{ name: string; fn: EaseFn }> = [
  { name: 'linear 匀速', fn: ease.linear },
  { name: 'quadIn 慢起', fn: ease.quadIn },
  { name: 'quadOut 快起慢停', fn: ease.quadOut },
  { name: 'quadInOut 两头慢', fn: ease.quadInOut },
  { name: 'backOut 冲过头', fn: ease.backOut },
  { name: 'elasticOut 弹簧', fn: ease.elasticOut },
]

const COLORS = ['#8ad4ff', '#8ae9c0', '#ffe98a', '#ffc97a', '#ff8a8a', '#b08aff']
/** 起点与终点：缓动的差别就是"怎么从这头走到那头" */
const FROM = -7
const TO = 7
const SPACING = 1.75

let lanes: Lane[] = []
/** 六条跑道（做成薄板而不是线：WebGL 里线的粗细基本没法调，薄板更清楚） */
let tracks: THREE.Object3D[] = []

const params = { 时长: 1.6, 错开: 0.32, 显示轨道: true }

export const easingTry: Try = {
  id: '04-easing',
  title: '自己写缓动',
  summary:
    '六个小球从同一侧出发、到同一侧停下，只有速度曲线不同：匀速、慢起、快起慢停、两头慢、冲过头、弹簧。缓动不是魔法，就是一个把 0~1 映射成 0~1 的小函数。',
  hint: '在 core/kit.ts 的 ease 里加一个你自己的函数（比如 bounceOut），再往 LANES 里补一行 —— 面板和轨道都不用改。',
  tags: ['缓动函数', 'lerp', 'MeshBasicMaterial', '时间循环'],
  files: ['src/tries/04-easing.ts', 'src/core/kit.ts'],
  // 机位几乎正对着轨道：六条路径才是横平竖直的平行线，速度差别一眼可比
  camera: { radius: 21, theta: 0.12, phi: 0.8, target: [0, 0.5, 0] },

  build({ world }) {
    world.ground(46, 0x161c2c)
    world.lights()

    tracks = []
    lanes = LANES.map((item, index) => {
      const z = (index - (LANES.length - 1) / 2) * SPACING

      // 跑道：一条薄板，把"起点和终点"钉在画面里
      const track = new THREE.Mesh(
        // 板子躺着放，长度是起点到终点的距离再留一点余量
        new THREE.PlaneGeometry(TO - FROM + 3.2, 0.16),
        new THREE.MeshBasicMaterial({ color: 0x4a6ab0 }),
      )
      track.rotation.x = -Math.PI / 2
      track.position.set((FROM + TO) / 2, 0.03, z)
      world.add(track)
      tracks.push(track)

      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 18), mat(COLORS[index % COLORS.length]))
      ball.position.set(FROM, 0.44, z)
      ball.castShadow = true
      world.add(ball)

      // 名字挂在跑道中段的正上方：不管相机怎么转，它都不会被卡片或面板挡住
      const nameLabel = label(item.name, { size: 0.44 })
      nameLabel.position.set(0, 1.05, z)
      world.add(nameLabel)

      return { ball, ease: item.fn, phase: index * params.错开 }
    })

    const folder = world.folder('04 · 缓动')
    folder.add(params, '时长', 0.4, 4, 0.05).name('单程时长')
    folder.add(params, '错开', 0, 1, 0.02).name('出发错开')
    folder
      .add(params, '显示轨道')
      .name('显示跑道')
      .onChange((v: boolean) => tracks.forEach((track) => (track.visible = v)))
  },

  update(_dt, elapsed) {
    // 一个来回 = 走完 + 停一下
    const cycle = params.时长 + 0.4

    for (const lane of lanes) {
      // 每条轨道相位不同：画面上永远有小球在跑
      const local = (elapsed + lane.phase) % cycle
      const t = THREE.MathUtils.clamp(local / params.时长, 0, 1)

      // 位移本身永远是同一句 lerp，变的只有 t 的形状
      lane.ball.position.x = lerp(FROM, TO, lane.ease(t))
    }
  },

  dispose() {
    lanes = []
    tracks = []
  },
}
