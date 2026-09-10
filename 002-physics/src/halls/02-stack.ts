import type { Hall } from './types'

const ROWS = 9
const COLS = 13
const BLOCK = 0.86

/**
 * 尺寸和排布间距都用同一个 BLOCK：砖块之间**零间隙**。
 *
 * 三个坑都踩过了：
 *   - 留正常施工缝（哪怕 2cm）→ 一百多块砖同时下落撞击，塔自己垮掉
 *   - 留 1mm 以下的缝 → 小于 Rapier 的接触容差，被判定成互相穿插，直接弹飞
 *   - 堆太高（试过 16 层金字塔）→ 迭代式约束求解器的"接触链"太长，
 *     底层的力还没收敛就被上层压穿，整塔像果冻一样散掉
 *
 * 现在换成矮而宽的砖墙：结构高度只有 7.7 米，接触链短得多，
 * 而且交错砌法让每块砖都压在两块上，是最稳的排布。
 */
const BLOCK_SIZE = BLOCK

let dropTimer = 0

export const stackHall: Hall = {
  id: '02-stack',
  title: '砖墙与堆叠',
  desc: `${ROWS} 层 ${COLS} 列，${ROWS * COLS} 块砖交错砌成一堵墙。堆叠是最能暴露求解器质量的地方 —— 摩擦力、恢复系数、休眠阈值、迭代次数，任何一项没调好，墙都会自己抖着塌掉。每 6 秒会有一颗球砸过来。`,
  tags: ['stacking', 'friction', 'sleeping', 'solver iterations'],

  // phi 接近 π/2 是平视。之前用 1.0（俯视 57°）会让 7.7 米高的墙被透视压成一条，
  // 看上去像塌了 —— 其实一点没动。
  camera: { radius: 19, theta: 0.45, phi: 1.36, target: [0, 3.8, 0] },

  build({ stage }) {
    stage.addGround(60)
    // 一圈矮墙把砖留在场地里，否则会被砸得满世界都是
    stage.addArena(44, 7)
    // 先让墙站稳几秒，否则第一眼看到的是一地碎砖
    dropTimer = 9

    for (let row = 0; row < ROWS; row++) {
      // 隔行错开半块 —— 交错砌法让每块砖都压在两块上，这是墙能立住的关键
      const offset = (row % 2) * BLOCK_SIZE * 0.5
      const y = BLOCK_SIZE / 2 + row * BLOCK_SIZE
      const hue = 0.55 + (row / ROWS) * 0.22

      for (let col = 0; col < COLS; col++) {
        const x = (col - (COLS - 1) / 2) * BLOCK_SIZE + offset

        // 零间隙排布会让同一排的砖严丝合缝地并成一条，所以每块砖都得有
        // 自己的明度抖动，否则整面墙会读成"九块大板"而不是一面砖墙。
        const grain = ((row * 7 + col * 13) % 5) / 5 - 0.4
        const lightness = 0.34 + (row / ROWS) * 0.34 + grain * 0.09

        stage.spawn({
          shape: { kind: 'box', size: [BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE * 0.6] },
          position: [x, y, 0],
          color: hsl(hue, 0.45, lightness),
          // 高摩擦 + 零恢复是堆叠能站住的两个关键
          friction: 1.0,
          restitution: 0,
          density: 1.2,
          linearDamping: 0.15,
          angularDamping: 0.25,
        })
      }
    }
  },

  update(dt, _elapsed, ctx) {
    dropTimer -= dt
    if (dropTimer > 0) return
    // 间隔拉长、球变小变轻：砸掉顶上一两块是看点，整墙塌掉就没得看了
    dropTimer = 6

    ctx.stage.spawn({
      shape: { kind: 'ball', radius: 0.42 + Math.random() * 0.2 },
      position: [(Math.random() - 0.5) * 3, 18, (Math.random() - 0.5) * 3],
      color: '#ff8f5e',
      density: 2,
      restitution: 0.28,
      ccd: true,
    })
  },
}

/** three 的 Color 接受 hsl 字符串，这里顺便做点色彩分层 */
function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
}
