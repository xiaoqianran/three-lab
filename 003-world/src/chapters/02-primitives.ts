import * as THREE from 'three'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 02 · 三件套：几何 / 材质 / 网格
 *
 * three.js 里的一切可见物体都是这三个东西的组合：
 *   Geometry（几何）—— 形状，一堆顶点属性
 *   Material（材质）—— 表面长什么样，怎么和光打交道
 *   Mesh（网格）    —— 把前两者绑在一起，再加上位置 / 旋转 / 缩放
 *
 * 这一章把内置几何体几乎全部摆一遍。它们都是"参数化"的：
 * 给不同的分段数，同一个类就能从粗糙的方块变成光滑的球。
 *
 * 顺便埋一个后面会反复用到的认知：
 * 标准材质（MeshStandardMaterial）没有光照就是**纯黑**的，
 * 所以这一章默认用法线材质 —— 它把方向当作颜色，不需要任何光源就能看清形状。
 */

interface Entry {
  mesh: THREE.Mesh
  color: number
  /** 切到标准材质时复用同一个实例，避免每次切换都新建材质 */
  standard: THREE.MeshStandardMaterial | null
}

let entries: Entry[] = []
let labels: THREE.Sprite[] = []
let lights: THREE.Object3D[] = []

/** 内置几何体全家福：直角坐标排成 5 列 × 3 行 */
const SHAPES: Array<{ name: string; geometry: THREE.BufferGeometry; color: number }> = [
  { name: 'BoxGeometry', geometry: new THREE.BoxGeometry(1.6, 1.6, 1.6), color: 0xff8a8a },
  { name: 'SphereGeometry', geometry: new THREE.SphereGeometry(0.95, 32, 16), color: 0xffc97a },
  { name: 'PlaneGeometry', geometry: new THREE.PlaneGeometry(1.8, 1.8), color: 0xffe98a },
  { name: 'CircleGeometry', geometry: new THREE.CircleGeometry(0.95, 32), color: 0xb6f08a },
  { name: 'RingGeometry', geometry: new THREE.RingGeometry(0.5, 0.95, 32), color: 0x8ae9c0 },
  { name: 'CylinderGeometry', geometry: new THREE.CylinderGeometry(0.6, 0.6, 1.7, 32), color: 0x8ad4ff },
  { name: 'ConeGeometry', geometry: new THREE.ConeGeometry(0.85, 1.7, 32), color: 0x8aa8ff },
  { name: 'CapsuleGeometry', geometry: new THREE.CapsuleGeometry(0.5, 1.0, 8, 16), color: 0xb08aff },
  { name: 'TorusGeometry', geometry: new THREE.TorusGeometry(0.75, 0.3, 16, 48), color: 0xff8ad4 },
  { name: 'TorusKnotGeometry', geometry: new THREE.TorusKnotGeometry(0.6, 0.2, 128, 24), color: 0xff9fb0 },
  { name: 'IcosahedronGeometry', geometry: new THREE.IcosahedronGeometry(0.95, 1), color: 0xa9ffd8 },
  { name: 'DodecahedronGeometry', geometry: new THREE.DodecahedronGeometry(0.95, 0), color: 0xc8f5ff },
  { name: 'OctahedronGeometry', geometry: new THREE.OctahedronGeometry(0.95, 0), color: 0xd7ccff },
  { name: 'TetrahedronGeometry', geometry: new THREE.TetrahedronGeometry(1.0, 0), color: 0xffd9a8 },
  {
    // 同一个类，只是分段数变小，观感立刻从"球"变成"多面体"。
    // 分段数（widthSegments / heightSegments / radialSegments ...）是参数化几何体的灵魂
    name: 'SphereGeometry 6×4',
    geometry: new THREE.SphereGeometry(0.95, 6, 4),
    color: 0xffb48a,
  },
]

const MODES = ['法线材质', '标准材质', '线框'] as const

// 共享材质：所有物体用同一个实例，切换时不必反复新建。
// 这也是真实项目里的常规做法 —— WebGL 会按材质维度缓存着色器程序
const normalMaterial = new THREE.MeshNormalMaterial()
const wireMaterial = new THREE.MeshBasicMaterial({ color: 0x7fb2ff, wireframe: true })

export const primitives: Chapter = {
  id: '02-primitives',
  title: '三件套：几何 / 材质 / 网格',
  summary:
    '把 three.js 自带的基础几何体一次性摆齐：盒、球、面、圆、环、柱、锥、胶囊、环面、环面结、四种正多面体、以及直接用顶点数组拼的自定义多面体。重点不是记住参数，而是理解"分段数决定平滑度"以及"材质决定它怎么和光打交道"。',
  apis: [
    'BoxGeometry', 'SphereGeometry', 'PlaneGeometry', 'CircleGeometry', 'RingGeometry',
    'CylinderGeometry', 'ConeGeometry', 'CapsuleGeometry', 'TorusGeometry', 'TorusKnotGeometry',
    'PolyhedronGeometry', 'MeshNormalMaterial', 'MeshStandardMaterial', 'EdgesGeometry', 'LineSegments',
  ],
  files: ['src/chapters/02-primitives.ts', 'src/core/Label.ts'],
  camera: { radius: 15, theta: 0.34, phi: 1.08, target: [0, 1.4, 0] },

  build({ world, scene }) {
    world.ground(60)
    world.grid(24, 24)

    // 光线：标准材质要靠它们才能亮起来（默认关掉，用来演示"没光就是黑的"）
    const ambient = new THREE.AmbientLight(0xdfe8ff, 1.6)
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(6, 10, 6)
    const rim = new THREE.DirectionalLight(0x88aaff, 1.2)
    rim.position.set(-7, 5, -6)
    lights = [ambient, key, rim]
    lights.forEach((light) => scene.add(light))
    lights.forEach((light) => (light.visible = false))

    // 一句话说清"几何体只是顶点属性"：任何几何体都能生成同形状的棱边线框
    const edges = new THREE.EdgesGeometry(SHAPES[0].geometry)
    const boxEdges = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.9 }),
    )
    boxEdges.position.set(-5.6, 0.02, 3.2)
    world.add(boxEdges)
    const edgesLabel = createLabel('EdgesGeometry', { size: 0.3 })
    edgesLabel.position.set(-5.6, 1.9, 3.2)
    world.add(edgesLabel)

    // 主排：5 列 × 3 行
    labels = []
    entries = SHAPES.map(({ name, geometry, color }, index) => {
      const column = index % 5
      const row = Math.floor(index / 5)

      const mesh = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial())
      mesh.position.set((column - 2) * 2.8, 1.45, (row - 1) * 3.2)
      // 稍微转一下，让扁平几何体（Plane / Circle / Ring）也能看见正反面
      mesh.rotation.y = row === 0 ? -0.5 : 0.4
      world.add(mesh)

      const label = createLabel(name, { size: 0.3 })
      label.position.set(mesh.position.x, mesh.position.y + 1.35, mesh.position.z)
      world.add(label)
      labels.push(label)

      return { mesh, color, standard: null }
    })

    // ---- 本章参数 ----
    const params = {
      材质: MODES[0] as string,
      开灯: false,
      显示标签: true,
      自转: true,
    }

    const folder = world.folder('第 02 章')
    folder.add(params, '材质', MODES as unknown as string[]).name('材质').onChange(applyMode)
    folder
      .add(params, '开灯')
      .name('打开光照')
      .onChange((on: boolean) => lights.forEach((light) => (light.visible = on)))
    folder.add(params, '自转').name('自转')
    folder
      .add(params, '显示标签')
      .name('显示标签')
      .onChange((on: boolean) => labels.forEach((label) => (label.visible = on)))

    applyMode(params.材质)
    state = params
  },

  update(dt) {
    if (!state.自转) return
    for (const entry of entries) {
      // 每行用不同角速度，画面更有层次
      entry.mesh.rotation.y += dt * 0.35
      entry.mesh.rotation.x += dt * 0.12
    }
  },
}

let state = { 材质: MODES[0] as string, 开灯: false, 显示标签: true, 自转: true }

/** 切换材质：法线材质 / 标准材质 / 线框 */
function applyMode(mode: string): void {
  for (const entry of entries) {
    if (mode === '法线材质') {
      entry.mesh.material = normalMaterial
    } else if (mode === '标准材质') {
      // 标准材质按每个物体的颜色各自创建一个，创建一次后复用
      entry.standard ??= new THREE.MeshStandardMaterial({ color: entry.color, roughness: 0.42, metalness: 0.08 })
      entry.mesh.material = entry.standard
    } else {
      entry.mesh.material = wireMaterial
    }
  }
}
