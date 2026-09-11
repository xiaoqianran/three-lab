import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 10 · 数量：实例化 / 点云 / 合并 / LOD
 *
 * 当物体从"几个"变成"几千个"，瓶颈就不再是显卡算得多快，而是
 * **CPU 提交了多少次绘制命令**（draw call）。右下角的"批次"数字就是它。
 *
 * 把数量堆上去的几种办法：
 *   InstancedMesh   同一个几何体 + 同一材质，一次绘制画 N 个（每个实例有自己的矩阵和颜色）
 *   Points          只要"点"不要面，上万个点也只算一次绘制（最便宜的规模）
 *   mergeGeometries 把多个几何体烘成一个：牺牲"单独控制"，换取一次绘制
 *   BatchedMesh     一次绘制，但允许混用**不同几何体**
 *   LOD             离得远就换低精度模型，省的是顶点和显存
 */

const GRID_SIDE = 64
const MAX_INSTANCES = GRID_SIDE * GRID_SIDE

let instanced: THREE.InstancedMesh | null = null
let stars: THREE.Points | null = null
let lod: THREE.LOD | null = null
let lodLevelController: { updateDisplay(): unknown } | null = null
/** 复用的临时对象：每帧 new 一个会制造大量垃圾 */
const dummy = new THREE.Object3D()
let waveTime = 0

const params = { 实例数量: 1600, 波形起伏: 0.75, 星空: true, 自转: true }
const lodInfo = { 当前层级: '-', 到相机距离: '-' }

/** 把"第 index 个实例"摊成网格坐标：这样实例数量一变，方块阵仍然是以原点为中心的正方形 */
function layout(index: number, side: number): { x: number; z: number } {
  const offset = (side - 1) / 2
  const column = index % side
  const row = Math.floor(index / side)
  return { x: (column - offset) * 0.5, z: (row - offset) * 0.5 }
}

export const instancing: Chapter = {
  id: '10-instancing',
  title: '数量：实例化 / 点云 / 合并',
  summary:
    '同一个立方体画一千六百次（实例化，1 次绘制），一万两千个点铺成星空（点云，1 次绘制），24 个小方块直接合并成 1 个几何体。对照组的"独立 Mesh"会老老实实提交 24 次绘制 —— 盯着右下角的批次数字看，差距一目了然。再加一个按距离自动降精度的 LOD。',
  apis: [
    'InstancedMesh', 'setMatrixAt', 'setColorAt', 'instanceMatrix', 'DynamicDrawUsage',
    'Points', 'PointsMaterial', 'sizeAttenuation', 'mergeGeometries', 'BatchedMesh',
    'addGeometry / addInstance', 'LOD', 'draw call',
  ],
  files: ['src/chapters/10-instancing.ts', 'src/core/Label.ts'],
  camera: { radius: 36, theta: 0.42, phi: 0.92, target: [0, 1, 0] },

  build({ world, scene }) {
    world.ground(160, 0, 0x0e1526)
    scene.add(new THREE.HemisphereLight(0xa9caff, 0x22304d, 1.3))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(14, 20, 12)
    scene.add(key)

    // ---------------------------------------------------------- A. InstancedMesh
    // 几何体和材质只有一份，每个实例只多存一个 4×4 矩阵（外加可选的颜色）
    instanced = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.34, 0.34, 0.34),
      new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.25 }),
      MAX_INSTANCES,
    )
    // 告诉 three"这批矩阵每帧都会变"，驱动会据此选择更合适的显存用法
    instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    const color = new THREE.Color()
    for (let index = 0; index < MAX_INSTANCES; index++) {
      const { x, z } = layout(index, GRID_SIDE)
      // setColorAt 会按需创建 instanceColor 属性，之后每个实例就能各显示一种颜色
      color.setHSL(0.54 + (x + 16) / 32 * 0.2, 0.62, 0.42 + (z + 16) / 32 * 0.22)
      instanced.setColorAt(index, color)
    }
    instanced.count = params.实例数量
    world.add(instanced)

    // ---------------------------------------------------------- B. Points 星空
    const STAR_COUNT = 12000
    const positions = new Float32Array(STAR_COUNT * 3)
    const colors = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT; i++) {
      // 球面均匀取点：高度均匀分布 + 方位角均匀分布，才不会在两极挤成一团
      const z = Math.random() * 2 - 1
      const angle = Math.random() * Math.PI * 2
      const radius = 50 + Math.random() * 50
      const spread = Math.sqrt(1 - z * z)

      positions[i * 3] = Math.cos(angle) * spread * radius
      positions[i * 3 + 1] = Math.abs(z) * radius * 0.55 + 8
      positions[i * 3 + 2] = Math.sin(angle) * spread * radius

      const tint = 0.6 + Math.random() * 0.4
      colors[i * 3] = tint * (0.72 + Math.random() * 0.28)
      colors[i * 3 + 1] = tint * 0.86
      colors[i * 3 + 2] = tint
    }

    const starGeometry = new THREE.BufferGeometry()
    // 顶点属性直接喂 Float32Array —— 这就是 Points 最原始的形态
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 0.5,
        vertexColors: true,
        // 点的大小随距离变化，远处的星自然变小
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        // 关掉深度写入，星星之间不会互相切出硬边
        depthWrite: false,
      }),
    )
    world.add(stars)

    // ---------------------------------------------------------- C. 合并几何体 vs 独立 Mesh
    const partGeometry = new THREE.BoxGeometry(0.55, 0.55, 0.55)
    const partMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a8a, roughness: 0.5 })
    const matrix = new THREE.Matrix4()
    const mergedParts: THREE.BufferGeometry[] = []
    const scatter: Array<[number, number, number]> = []

    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2
      const radius = 2.6 + (i % 3) * 0.9
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const y = 0.6 + (i % 4) * 0.55
      scatter.push([x, y, z])

      // clone 出独立的一份，再把"平移到位"这一步直接烘进顶点数据里
      const clone = partGeometry.clone()
      clone.applyMatrix4(matrix.makeTranslation(x, y, z))
      mergedParts.push(clone)
    }

    // 左：24 个独立 Mesh —— 24 次绘制，但每个都能单独动、单独换材质
    for (const [x, y, z] of scatter) {
      const mesh = new THREE.Mesh(partGeometry, partMaterial)
      mesh.position.set(x - 15, y, z - 5)
      world.add(mesh)
    }

    // 右：合并成 1 个几何体 —— 1 次绘制，代价是这些方块从此"焊死"在一起
    const merged = new THREE.Mesh(
      mergeGeometries(mergedParts, false) ?? new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x8affc0, roughness: 0.45, metalness: 0.2 }),
    )
    merged.position.set(15, 0, -5)
    world.add(merged)

    // 临时几何体用完了，手动释放（它们从没上过 GPU，dispose 只是走个流程）
    for (const part of mergedParts) part.dispose()

    // ---------------------------------------------------------- D. BatchedMesh
    // InstancedMesh 只能画同一个几何体；BatchedMesh 允许把不同几何体塞进同一次绘制
    //
    // ⚠️ 有个硬性约束：所有几何体必须**一致地**有索引或没有索引。
    // BoxGeometry / ConeGeometry / TorusGeometry 都是带 index 的；
    // 而 IcosahedronGeometry 这类多面体是"每个面独立顶点"，没有 index，
    // 混在一起会直接报错：All geometries must consistently have "index"
    const shapes = [
      new THREE.BoxGeometry(0.7, 0.7, 0.7),
      new THREE.TorusGeometry(0.38, 0.16, 10, 24),
      new THREE.ConeGeometry(0.42, 0.95, 8),
    ]
    const perShape = 30

    // 顶点 / 索引缓冲区要预留得下所有实例，先把总量算出来
    let maxVertices = 0
    let maxIndices = 0
    for (const geometry of shapes) {
      const vertexCount = geometry.attributes.position.count
      const indexCount = geometry.index ? geometry.index.count : vertexCount
      maxVertices += vertexCount * perShape
      maxIndices += indexCount * perShape
    }

    const batched = new THREE.BatchedMesh(
      shapes.length * perShape,
      maxVertices,
      maxIndices,
      new THREE.MeshStandardMaterial({ color: 0xb08aff, roughness: 0.4, metalness: 0.3 }),
    )

    let seed = 0
    for (const geometry of shapes) {
      const vertexCount = geometry.attributes.position.count
      const indexCount = geometry.index ? geometry.index.count : vertexCount
      // addGeometry 把这套几何体登记进共享缓冲区并返回编号
      const geometryId = batched.addGeometry(geometry, vertexCount * perShape, indexCount * perShape)

      for (let i = 0; i < perShape; i++) {
        const instanceId = batched.addInstance(geometryId)
        seed += 1
        // 用确定性的伪随机，保证每次刷新布局都一样
        const x = Math.sin(seed * 12.9898) * 3.6
        const z = Math.cos(seed * 78.233) * 3.6
        dummy.position.set(15 + x, 0.75 + (seed % 5) * 0.42, 7 + z)
        dummy.rotation.set(seed * 0.3, seed * 0.6, 0)
        dummy.scale.setScalar(0.85 + (seed % 3) * 0.15)
        dummy.updateMatrix()
        batched.setMatrixAt(instanceId, dummy.matrix)
      }
    }
    world.add(batched)

    // ---------------------------------------------------------- E. LOD
    // 同一颗"星球"三个精度：近处高分段，中距离降一档，远处再降一档
    lod = new THREE.LOD()
    const levelColors = [0x8affc0, 0xffe08a, 0xff8a8a]
    const levelSegments: Array<[number, number, number]> = [
      [48, 32, 0],
      [14, 10, 16],
      [6, 4, 30],
    ]
    for (const [widthSegments, heightSegments, distance] of levelSegments) {
      const levelMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, widthSegments, heightSegments),
        new THREE.MeshStandardMaterial({
          color: levelColors[levelSegments.findIndex((s) => s[2] === distance)],
          roughness: 0.45,
          metalness: 0.1,
          flatShading: distance > 0,
        }),
      )
      // 第二个参数是"从多少距离开始用这一级"
      lod.addLevel(levelMesh, distance)
    }
    lod.position.set(0, 1.8, -12)
    world.add(lod)

    // ---------------------------------------------------------- 标签
    const labels = [
      { text: 'InstancedMesh · 1600 个方块 = 1 次绘制', position: new THREE.Vector3(0, 8.4, 4) },
      { text: '24 个独立 Mesh = 24 次绘制', position: new THREE.Vector3(-15, 4.4, -5) },
      { text: '1 个合并几何体 = 1 次绘制', position: new THREE.Vector3(15, 4.4, -5) },
      { text: 'BatchedMesh · 3 种几何体 = 1 次绘制', position: new THREE.Vector3(15, 4.4, 7) },
      { text: 'LOD · 越远精度越低', position: new THREE.Vector3(0, 4.4, -12) },
    ]
    for (const item of labels) {
      const label = createLabel(item.text, { size: 0.6 })
      label.position.copy(item.position)
      world.add(label)
    }

    // ---------------------------------------------------------- 面板
    const folder = world.folder('第 10 章')
    folder
      .add(params, '实例数量', 64, MAX_INSTANCES, 64)
      .name('实例数量')
      .onChange((v: number) => {
        if (instanced) instanced.count = v
      })
    folder.add(params, '波形起伏', 0, 2.5, 0.05).name('波形起伏')
    folder.add(params, '自转').name('星空自转')
    folder
      .add(params, '星空')
      .name('显示星空')
      .onChange((v: boolean) => {
        if (stars) stars.visible = v
      })
    lodLevelController = folder.add(lodInfo, '当前层级').disable()
    folder.add(lodInfo, '到相机距离').disable()
  },

  update(dt, _elapsed, { camera }) {
    waveTime += dt

    // ---- 实例化：每帧重算一百多个到四千个矩阵 ----
    // 注意只更新矩阵，绘制依然只有 1 次
    if (instanced) {
      const side = Math.max(8, Math.floor(Math.sqrt(instanced.count)))
      let index = 0
      for (let i = 0; i < side * side; i++) {
        const { x, z } = layout(i, side)
        const wave =
          Math.sin(x * 0.42 + waveTime * 1.4) * Math.cos(z * 0.42 - waveTime * 1.1) * params.波形起伏

        dummy.position.set(x, 0.9 + wave, z)
        dummy.rotation.set(wave * 0.3, waveTime * 0.4, wave * 0.3)
        dummy.scale.setScalar(0.85 + wave * 0.12)
        dummy.updateMatrix()
        instanced.setMatrixAt(index, dummy.matrix)
        index++
      }
      // 改完矩阵必须打这个标记，否则显存里还是上一帧的数据
      instanced.instanceMatrix.needsUpdate = true
    }

    if (stars && params.自转) stars.rotation.y += dt * 0.02

    // ---- LOD：让它沿 Z 轴来回走，观察层级切换 ----
    if (lod) {
      lod.position.z = -6 - ((Math.sin(waveTime * 0.25) + 1) / 2) * 26
      // getCurrentLevel 是只读的；真正决定用哪一级的是渲染时自动执行的 lod.update(camera)
      lodInfo.当前层级 = `${lod.getCurrentLevel()} 级 / 共 3 级`
      lodInfo.到相机距离 = `${camera.camera.position.distanceTo(lod.position).toFixed(1)} m`
      lodLevelController?.updateDisplay()
    }
  },

  dispose() {
    instanced = null
    stars = null
    lod = null
    lodLevelController = null
    waveTime = 0
  },
}
