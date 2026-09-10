import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

const GRID = 80
const SIZE = 96
const HEIGHT = 10

let terrainMesh: THREE.Mesh | null = null
let terrainGeometry: THREE.BufferGeometry | null = null
let terrainMaterial: THREE.MeshStandardMaterial | null = null
let heights: Float32Array | null = null
let dropTimer = 0

// ------------------------------------------------------------
//  地形噪声：value noise + fBm
// ------------------------------------------------------------

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi

  // 平滑插值，否则会看到明显的方格
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)

  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function fbm(x: number, y: number): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0

  for (let octave = 0; octave < 5; octave++) {
    sum += amp * valueNoise(x * freq, y * freq)
    norm += amp
    amp *= 0.5
    freq *= 2.07
  }

  return sum / norm
}

/**
 * 采样某点的高度（世界坐标）。
 * 索引约定：i = iz * GRID + ix（ix 沿 x，iz 沿 z），
 * 这份约定在生成顶点、生成 trimesh 索引、以及采样时都保持一致。
 */
function heightAt(x: number, z: number): number {
  if (!heights) return 0

  const fi = ((x / SIZE) + 0.5) * (GRID - 1)
  const fj = ((z / SIZE) + 0.5) * (GRID - 1)

  const ix = Math.max(0, Math.min(GRID - 1, Math.round(fi)))
  const iz = Math.max(0, Math.min(GRID - 1, Math.round(fj)))

  return heights[iz * GRID + ix]
}

function cellIndex(ix: number, iz: number): number {
  return iz * GRID + ix
}

export const terrainHall: Hall = {
  id: '04-terrain',
  title: '高度场山谷',
  desc: '一串球从山脊滚进中央盆地，在坡面上反复弹跳、加速、互相碰撞。地形本身是一张三角网格碰撞体（trimesh）—— 和视觉网格用的是同一份顶点数据，所以看上去和踩上去完全一致。',
  tags: ['trimesh collider', 'friction', 'restitution', 'CCD'],

  // 压低机位：俯角太大时地形会被透视压平，"山谷"的落差看不出来
  camera: { radius: 52, theta: 0.95, phi: 1.05, target: [0, 2, 0] },

  build({ stage, scene, physics }) {
    dropTimer = 0

    // ---- 生成高度矩阵 ----
    const n = GRID
    const data = new Float32Array(n * n)

    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const u = ix / (n - 1)
        const v = iz / (n - 1)

        // 中心挖低，形成盆地，滚下来的球会聚在中间
        const dx = u - 0.5
        const dz = v - 0.5
        const basin = 1 - Math.exp(-(dx * dx + dz * dz) * 9)

        const h = (fbm(u * 3.4, v * 3.4) * 0.9 + 0.1) * HEIGHT
        data[cellIndex(ix, iz)] = h * basin
      }
    }

    heights = data

    // ---- 顶点缓冲：物理与渲染共用同一份，保证"看到的就是踩到的" ----
    const vertices = new Float32Array(n * n * 3)

    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = cellIndex(ix, iz) * 3
        vertices[i] = (ix / (n - 1) - 0.5) * SIZE
        vertices[i + 1] = data[cellIndex(ix, iz)]
        vertices[i + 2] = (iz / (n - 1) - 0.5) * SIZE
      }
    }

    const indices = new Uint32Array((n - 1) * (n - 1) * 6)
    let cursor = 0

    for (let iz = 0; iz < n - 1; iz++) {
      for (let ix = 0; ix < n - 1; ix++) {
        const a = cellIndex(ix, iz)
        const b = cellIndex(ix + 1, iz)
        const c = cellIndex(ix, iz + 1)
        const d = cellIndex(ix + 1, iz + 1)

        // 逆时针绕序 => 法线朝上
        indices[cursor++] = a
        indices[cursor++] = c
        indices[cursor++] = b
        indices[cursor++] = b
        indices[cursor++] = c
        indices[cursor++] = d
      }
    }

    // ---- 物理碰撞体 ----
    // 用 trimesh 而不是 heightfield：Rapier 0.20 的 heightfield 在当前
    // 环境下 createCollider 会直接 panic，而 trimesh 的顶点顺序完全可控。
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.92).setRestitution(0.18),
      body,
    )

    // ---- 渲染网格 ----
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeVertexNormals()

    // 按高度上色。
    // 单一颜色 + 平面着色时，整片地形会糊成一块看不出起伏的蓝色曲面。
    // 从谷底深蓝渐变到峰顶青白之后，"山谷"的形状一眼就能读出来。
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < vertices.length; i += 3) {
      if (vertices[i] < minY) minY = vertices[i]
      if (vertices[i] > maxY) maxY = vertices[i]
    }
    const span = Math.max(0.001, maxY - minY)

    const low = new THREE.Color('#16233f')
    const mid = new THREE.Color('#2f6f8f')
    const high = new THREE.Color('#93ded8')
    const colors = new Float32Array(vertices.length)

    for (let i = 0; i < vertices.length; i += 3) {
      const t = (vertices[i + 1] - minY) / span
      const c =
        t < 0.5 ? low.clone().lerp(mid, t * 2) : mid.clone().lerp(high, (t - 0.5) * 2)

      colors[i] = c.r
      colors[i + 1] = c.g
      colors[i + 2] = c.b
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.04,
      flatShading: true,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    mesh.castShadow = true
    scene.add(mesh)

    terrainMesh = mesh
    terrainGeometry = geometry
    terrainMaterial = material

    // ---- 峰顶撒一批球 ----
    stage.spawnMany(40, (i) => {
      const angle = (i / 40) * Math.PI * 2
      const radius = 22 + Math.random() * 18
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius

      return {
        shape: { kind: 'ball', radius: 0.5 + Math.random() * 0.6 },
        position: [x, heightAt(x, z) + 1.5, z],
        color: i % 3 === 0 ? '#ff8f5e' : i % 3 === 1 ? '#7ee0d0' : '#c9d4ff',
        friction: 0.7,
        restitution: 0.35,
        density: 1.4,
        ccd: true,
      }
    })
  },

  update(dt, _elapsed, ctx) {
    dropTimer -= dt
    if (dropTimer > 0) return
    dropTimer = 0.45

    // 持续从高空投放，保证山谷里一直有东西在滚
    const x = (Math.random() - 0.5) * SIZE * 0.8
    const z = (Math.random() - 0.5) * SIZE * 0.8

    ctx.stage.spawn({
      shape: { kind: 'ball', radius: 0.45 + Math.random() * 0.5 },
      position: [x, heightAt(x, z) + 22, z],
      color: Math.random() > 0.5 ? '#ffd93d' : '#6bcb77',
      friction: 0.7,
      restitution: 0.32,
      density: 1.5,
      ccd: true,
    })
  },

  dispose({ scene }) {
    if (terrainMesh) scene.remove(terrainMesh)
    terrainGeometry?.dispose()
    terrainMaterial?.dispose()

    terrainMesh = null
    terrainGeometry = null
    terrainMaterial = null
    heights = null
  },
}
