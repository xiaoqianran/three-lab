import * as THREE from 'three'
import type { Hall } from './types'

const RES = 28
const SIZE = 9
const TOP_Y = 11
const GRAVITY = -12
const DAMPING = 0.985
const ITERATIONS = 4

interface Constraint {
  a: number
  b: number
  rest: number
}

let mesh: THREE.Mesh | null = null
let geometry: THREE.BufferGeometry | null = null
let material: THREE.MeshStandardMaterial | null = null

let positions: Float32Array | null = null
let previous: Float32Array | null = null
let constraints: Constraint[] = []
/** 固定点用查表代替 Set —— 约束迭代里每个点要查两次，这里省下来的很可观 */
let isPinned: Uint8Array | null = null
let pinTargets: Float32Array | null = null

export const clothHall: Hall = {
  id: '16-cloth',
  title: 'Verlet 布料',
  desc: '这块布完全没有用 Rapier —— 它是手写的 Verlet 积分：每个节点记住上一帧位置，用「当前位置减去上一帧位置」代替速度；再用 4 轮距离约束迭代把每一根网格线拉回原长。就这两步，布就能飘、能堆、能自己抚平褶皱。',
  tags: ['Verlet integration', 'distance constraints', 'position based dynamics'],

  camera: { radius: 24, theta: 0.5, phi: 1.06, target: [0, 5.6, 0] },

  build({ scene, stage }) {
    // 布料本身不走 Rapier，但地面得有 —— 没有地面这块布会像飘在虚空里，
    // 完全看不出它离地多高、往哪儿垂。
    stage.addGround(48)

    const count = RES * RES

    positions = new Float32Array(count * 3)
    previous = new Float32Array(count * 3)
    isPinned = new Uint8Array(count)
    pinTargets = new Float32Array(count * 3)

    for (let y = 0; y < RES; y++) {
      for (let x = 0; x < RES; x++) {
        const i = (y * RES + x) * 3
        const px = (x / (RES - 1) - 0.5) * SIZE
        const py = TOP_Y - (y / (RES - 1)) * SIZE

        positions[i] = px
        positions[i + 1] = py
        positions[i + 2] = 0

        previous[i] = px
        previous[i + 1] = py
        previous[i + 2] = 0
      }
    }

    // ---- 约束：结构约束（横竖）+ 剪切约束（对角）----
    constraints = []

    const link = (a: number, b: number) => {
      const dx = positions![a * 3] - positions![b * 3]
      const dy = positions![a * 3 + 1] - positions![b * 3 + 1]
      const dz = positions![a * 3 + 2] - positions![b * 3 + 2]
      constraints.push({ a, b, rest: Math.hypot(dx, dy, dz) })
    }

    for (let y = 0; y < RES; y++) {
      for (let x = 0; x < RES; x++) {
        const i = y * RES + x
        if (x < RES - 1) link(i, i + 1)
        if (y < RES - 1) link(i, i + RES)
        // 对角约束扛住剪切，没有它布会像橡皮膜一样塌成一条
        if (x < RES - 1 && y < RES - 1) link(i, i + RES + 1)
        if (x > 0 && y < RES - 1) link(i, i + RES - 1)
      }
    }

    // ---- 顶边钉死 ----
    for (let x = 0; x < RES; x++) {
      const index = x
      isPinned[index] = 1

      pinTargets[index * 3] = positions[index * 3]
      pinTargets[index * 3 + 1] = positions[index * 3 + 1]
      pinTargets[index * 3 + 2] = positions[index * 3 + 2]
    }

    // ---- 几何 ----
    geometry = new THREE.BufferGeometry()

    const indices: number[] = []
    for (let y = 0; y < RES - 1; y++) {
      for (let x = 0; x < RES - 1; x++) {
        const a = y * RES + x
        const b = a + 1
        const c = a + RES
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }

    geometry.setIndex(indices)

    const positionAttr = new THREE.BufferAttribute(new Float32Array(count * 3), 3)
    positionAttr.setUsage(THREE.DynamicDrawUsage)

    geometry.setAttribute('position', positionAttr)
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3))

    material = new THREE.MeshStandardMaterial({
      color: '#b45a86',
      side: THREE.DoubleSide,
      roughness: 0.82,
      metalness: 0.04,
    })

    mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    scene.add(mesh)
  },

  update(dt, elapsed) {
    if (!positions || !previous || !geometry || !isPinned || !pinTargets) return

    // 固定步长，否则帧率一抖布就会被扯飞
    const step = Math.min(dt, 1 / 45)
    const stepSq = step * step

    // 风：两个不同频率的正弦叠加，吹起来更像自然气流
    const wind = Math.sin(elapsed * 1.25) * 3.4 + Math.sin(elapsed * 2.7) * 1.5

    // ---- 1. Verlet 积分 ----
    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i]
      const py = positions[i + 1]
      const pz = positions[i + 2]

      const vx = (px - previous[i]) * DAMPING
      const vy = (py - previous[i + 1]) * DAMPING
      const vz = (pz - previous[i + 2]) * DAMPING

      previous[i] = px
      previous[i + 1] = py
      previous[i + 2] = pz

      positions[i] = px + vx + wind * stepSq * 0.9
      positions[i + 1] = py + vy + GRAVITY * stepSq
      positions[i + 2] = pz + vz
    }

    // ---- 2. 约束迭代 ----
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let k = 0; k < constraints.length; k++) {
        const c = constraints[k]
        const a = c.a * 3
        const b = c.b * 3

        const dx = positions[b] - positions[a]
        const dy = positions[b + 1] - positions[a + 1]
        const dz = positions[b + 2] - positions[a + 2]

        const dist = Math.hypot(dx, dy, dz) || 1e-6
        const scale = ((dist - c.rest) / dist) * 0.5

        const ox = dx * scale
        const oy = dy * scale
        const oz = dz * scale

        if (!isPinned[c.a]) {
          positions[a] += ox
          positions[a + 1] += oy
          positions[a + 2] += oz
        }
        if (!isPinned[c.b]) {
          positions[b] -= ox
          positions[b + 1] -= oy
          positions[b + 2] -= oz
        }
      }

      // 固定点每轮都要钉回去，否则会被邻居慢慢拖走
      for (let i = 0; i < isPinned.length; i++) {
        if (!isPinned[i]) continue
        positions[i * 3] = pinTargets[i * 3]
        positions[i * 3 + 1] = pinTargets[i * 3 + 1]
        positions[i * 3 + 2] = pinTargets[i * 3 + 2]
      }
    }

    // ---- 3. 写回缓冲 ----
    const attribute = geometry.attributes.position as THREE.BufferAttribute
    ;(attribute.array as Float32Array).set(positions)
    attribute.needsUpdate = true
    geometry.computeVertexNormals()
  },

  dispose({ scene }) {
    if (mesh) scene.remove(mesh)
    geometry?.dispose()
    material?.dispose()

    mesh = null
    geometry = null
    material = null
    positions = null
    previous = null
    isPinned = null
    pinTargets = null
    constraints = []
  },
}
