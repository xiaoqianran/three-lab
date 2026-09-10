import type { Hall } from './types'

const COUNT = 3600
const SIZE = 0.42

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
}

export const swarmHall: Hall = {
  id: '14-swarm',
  title: '万体压力测试',
  desc: `3600 个箱子同时下落、堆积、互相挤压，右下角的"批次"读数是这个展厅存在的理由：如果每个箱子都是独立 Mesh，这里就是 3600 次 draw call；因为同形状的物体全归到了同一个 InstancedMesh 桶里，实际只有 1 次。`,
  tags: ['InstancedMesh', '3600 rigid bodies', 'broad phase', 'island solver'],

  camera: { radius: 52, theta: 0.85, phi: 0.92, target: [0, 9, 0] },

  build({ stage }) {
    stage.addGround(80)
    stage.addArena(46, 18)

    stage.spawnMany(COUNT, (i) => {
      const angle = Math.random() * Math.PI * 2
      // sqrt 让点在圆面内均匀分布，否则会全挤在中心
      const radius = Math.sqrt(Math.random()) * 16
      const y = 2.5 + (i / COUNT) * 54

      return {
        shape: { kind: 'box', size: [SIZE, SIZE, SIZE] },
        position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
        color: hsl(0.5 + (i / COUNT) * 0.3, 0.5, 0.4 + (i / COUNT) * 0.24),
        friction: 0.6,
        restitution: 0.06,
        density: 1,
        linearDamping: 0.06,
        angularDamping: 0.12,
      }
    })
  },
}
