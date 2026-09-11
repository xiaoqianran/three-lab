import * as THREE from 'three'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 17 · 性能与调试
 *
 * 世界搭得越大，越要学会"看数字"。这一章把最常用的几把尺子都摆出来：
 *
 *   renderer.info   本帧的绘制批次 / 三角形数，以及显存里还留着多少几何体、贴图、着色器程序
 *   Box3 / Box3Helper  包围盒：判断"有多大""在不在画面里"都靠它
 *   Frustum         视锥：three 每帧就用它做自动剔除（object.frustumCulled）
 *   setPixelRatio   分辨率倍率：最直接的帧率开关
 *   dispose()       几何 / 材质 / 贴图都要手动释放，否则显存只增不减
 *
 * 三个可以亲手验证的对比：
 *   1. 300 个独立 Mesh（300 次绘制）vs 1 个 InstancedMesh（1 次绘制）
 *   2. 关掉 frustumCulled 之后，批次数字会变大 —— 说明自动剔除确实在省事
 *   3. 创建 / 释放几何体，盯着"几何体"那个数字涨落
 */

let instancedMesh: THREE.InstancedMesh | null = null
let separateMeshes: THREE.Mesh[] = []
let cloudCubes: THREE.Mesh[] = []
let scratchGroup: THREE.Group | null = null
let scratchMeshes: THREE.Mesh[] = []
let scratchMaterial: THREE.MeshStandardMaterial | null = null

/** 复用的临时对象，别在每帧里 new */
const frustum = new THREE.Frustum()
const projectionScreenMatrix = new THREE.Matrix4()

let culledMaterial: THREE.MeshBasicMaterial | null = null
let visibleMaterial: THREE.MeshStandardMaterial | null = null
let reportController: { updateDisplay(): unknown } | null = null

const params = { 独立网格: true, 实例化网格: true, 关闭视锥剔除: false, 分辨率倍率: 1 }
const report = {
  绘制批次: '-',
  三角形: '-',
  几何体: '-',
  贴图: '-',
  着色器程序: '-',
  云方块在视锥外: '-',
  临时几何体: '0',
}

export const performance: Chapter = {
  id: '17-performance',
  title: '性能与调试',
  summary:
    '左边 300 个独立 Mesh，右边 1 个 InstancedMesh —— 同样是 300 个方块，绘制批次差了 300 倍，"批次"这个数字就在右下角。中后方的方块云用来演示视锥剔除：把开关一关，批次立刻涨上去。最后亲手创建再释放一批几何体，看着显存里的数字涨落。',
  apis: [
    'renderer.info', 'draw call', 'Box3', 'Box3Helper', 'Frustum', 'intersectsObject',
    'frustumCulled', 'setPixelRatio', 'geometry.dispose()', 'memory.geometries',
  ],
  files: ['src/chapters/17-performance.ts', 'src/core/Label.ts'],
  camera: { radius: 48, theta: 0.52, phi: 1.0, target: [0, 1, 0] },

  build({ world, scene, renderer, camera }) {
    world.ground(200, 0, 0x0d1424)
    world.grid(80, 80)
    scene.add(new THREE.HemisphereLight(0xa9caff, 0x22304d, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(16, 24, 14)
    scene.add(key)

    // ---------------------------------------------------------- 1. 300 个独立 Mesh
    const boxGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.6)
    const separateMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a8a, roughness: 0.5 })

    for (let i = 0; i < 300; i++) {
      const mesh = new THREE.Mesh(boxGeometry, separateMaterial)
      const column = i % 20
      const row = Math.floor(i / 20)
      mesh.position.set(-24 + column * 0.95, 0.5 + (row % 3) * 1.1, -8 + (row % 5) * 1.1)
      mesh.castShadow = true
      world.add(mesh)
      separateMeshes.push(mesh)
    }

    // ---------------------------------------------------------- 2. 1 个 InstancedMesh
    const instancedGeometry = new THREE.BoxGeometry(0.6, 0.6, 0.6)
    instancedMesh = new THREE.InstancedMesh(
      instancedGeometry,
      new THREE.MeshStandardMaterial({ color: 0x8affc0, roughness: 0.45, metalness: 0.2 }),
      300,
    )
    const dummy = new THREE.Object3D()
    for (let i = 0; i < 300; i++) {
      const column = i % 20
      const row = Math.floor(i / 20)
      dummy.position.set(6 + column * 0.95, 0.5 + (row % 3) * 1.1, -8 + (row % 5) * 1.1)
      dummy.rotation.set(0, (i % 7) * 0.2, 0)
      dummy.updateMatrix()
      instancedMesh.setMatrixAt(i, dummy.matrix)
    }
    world.add(instancedMesh)

    const labelA = createLabel('300 个独立 Mesh → 300 次绘制', { size: 0.72 })
    labelA.position.set(-15, 6.4, -6)
    world.add(labelA)
    const labelB = createLabel('1 个 InstancedMesh → 1 次绘制', { size: 0.72 })
    labelB.position.set(15, 6.4, -6)
    world.add(labelB)

    // ---------------------------------------------------------- 3. 视锥剔除实验场
    const cloudGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5)
    visibleMaterial = new THREE.MeshStandardMaterial({ color: 0x8ad4ff, roughness: 0.5 })
    // 被剔出来的方块换一副"暗色不受光"的皮，方便一眼看出哪些在视锥外
    culledMaterial = new THREE.MeshBasicMaterial({ color: 0x1b2436 })

    for (let i = 0; i < 400; i++) {
      const cube = new THREE.Mesh(cloudGeometry, visibleMaterial)
      cube.position.set(
        (Math.random() - 0.5) * 46,
        0.4 + Math.random() * 7,
        -14 - Math.random() * 26,
      )
      cube.rotation.set(Math.random(), Math.random(), Math.random())
      world.add(cube)
      cloudCubes.push(cube)
    }

    const cloudLabel = createLabel('400 个方块 · 视锥剔除实验场', { size: 0.72 })
    cloudLabel.position.set(0, 10.5, -24)
    world.add(cloudLabel)

    // ---------------------------------------------------------- 4. 包围盒
    // Box3 是轴对齐包围盒：算一次，就能知道这一堆东西有多大、中心在哪
    const bounds = new THREE.Box3().setFromObject(world.root)
    const boundsHelper = new THREE.Box3Helper(bounds, 0xffc98a)
    world.add(boundsHelper)
    const size = new THREE.Vector3()
    bounds.getSize(size)
    const boundsLabel = createLabel(
      `Box3 · ${size.x.toFixed(0)} × ${size.y.toFixed(0)} × ${size.z.toFixed(0)}`,
      { size: 0.72 },
    )
    boundsLabel.position.set(0, size.y + 2.5, 0)
    world.add(boundsLabel)

    // CameraHelper 直接把视锥画出来：被剔除的就是"没落在这个体积里"的物体
    const helper = new THREE.CameraHelper(camera.camera)
    helper.visible = false
    world.add(helper)

    // ---------------------------------------------------------- 5. 临时几何体（显存涨落）
    scratchGroup = new THREE.Group()
    scratchGroup.position.set(0, 0, 22)
    world.add(scratchGroup)
    scratchMaterial = new THREE.MeshStandardMaterial({ color: 0xffd07a, roughness: 0.5 })

    const scratchLabel = createLabel('创建 / 释放几何体 · 看面板上的数字', { size: 0.72 })
    scratchLabel.position.set(0, 6, 22)
    world.add(scratchLabel)

    // ---------------------------------------------------------- 面板
    const folder = world.folder('第 17 章')
    reportController = folder.add(report, '绘制批次').disable()
    folder.add(report, '三角形').disable()
    folder.add(report, '几何体').disable()
    folder.add(report, '贴图').disable()
    folder.add(report, '着色器程序').disable()
    folder.add(report, '云方块在视锥外').disable()
    folder.add(report, '临时几何体').disable()

    folder
      .add(params, '独立网格')
      .name('显示独立 Mesh 组')
      .onChange((v: boolean) => separateMeshes.forEach((mesh) => (mesh.visible = v)))
    folder
      .add(params, '实例化网格')
      .name('显示实例化组')
      .onChange((v: boolean) => {
        if (instancedMesh) instancedMesh.visible = v
      })
    folder
      .add(params, '关闭视锥剔除')
      .name('关闭 frustumCulled')
      .onChange((v: boolean) => {
        // 关掉之后 three 就不再为这些物体做"在不在画面里"的判断，全部提交绘制
        for (const cube of cloudCubes) cube.frustumCulled = !v
        for (const mesh of separateMeshes) mesh.frustumCulled = !v
      })
    folder
      .add(params, '分辨率倍率', 0.4, 1.4, 0.05)
      .name('分辨率倍率 setPixelRatio')
      .onChange((v: number) => {
        // 画质换帧率：减少的是像素填充量，几何量不变
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * v)
      })
    folder.add(helper, 'visible').name('显示相机视锥')
    folder
      .add({ 创建: () => spawnScratch(200) }, '创建')
      .name('创建 200 个几何体')
    folder
      .add({ 释放: () => releaseScratch() }, '释放')
      .name('释放全部几何体')

    // ---- 读渲染统计 ----
    // 必须放在"渲染完成之后"：renderer.info 在每帧渲染前后会被清零，
    // 只有一帧刚画完的那一刻，里面的数字才是这一帧的完整总量
    world.onAfterRender(() => {
      const info = renderer.info
      report.绘制批次 = String(info.render.calls)
      report.三角形 = info.render.triangles.toLocaleString('en-US')
      report.几何体 = String(info.memory.geometries)
      report.贴图 = String(info.memory.textures)
      report.着色器程序 = String(info.programs?.length ?? 0)
      report.临时几何体 = String(scratchMeshes.length)
      reportController?.updateDisplay()
    })
  },

  update(_dt, _elapsed, { camera }) {
    // ---- 手动算一遍视锥，统计有多少方块在外面 ----
    // 相机矩阵变了，视锥必须重算
    projectionScreenMatrix.multiplyMatrices(camera.camera.projectionMatrix, camera.camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projectionScreenMatrix)

    let outside = 0
    for (const cube of cloudCubes) {
      // intersectsObject 用物体的**包围球**做粗略判断 —— 快，但物体很大时会不够精确
      const visible = frustum.intersectsObject(cube)
      if (!visible) outside++
      cube.material = visible ? visibleMaterial! : culledMaterial!
    }
    report.云方块在视锥外 = `${outside} / ${cloudCubes.length}`
  },

  dispose() {
    instancedMesh = null
    separateMeshes = []
    cloudCubes = []
    scratchGroup = null
    scratchMeshes = []
    scratchMaterial = null
    culledMaterial = null
    visibleMaterial = null
    reportController = null
  },
}

/** 现场造一批几何体：每个都改过顶点，确保它们是货真价实的不同对象 */
function spawnScratch(count: number): void {
  if (!scratchGroup || !scratchMaterial) return

  for (let i = 0; i < count; i++) {
    const geometry = new THREE.BoxGeometry(0.45, 0.45, 0.45)
    const position = geometry.attributes.position
    for (let v = 0; v < position.count; v++) {
      position.setY(v, position.getY(v) * (0.4 + Math.random()))
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()

    const mesh = new THREE.Mesh(geometry, scratchMaterial)
    mesh.position.set(((i % 20) - 10) * 0.7, 0.6 + Math.floor(i / 20) * 0.9, 0)
    mesh.castShadow = true
    scratchGroup.add(mesh)
    scratchMeshes.push(mesh)
  }
}

/** 释放：必须对每个几何体显式调用 dispose()，从场景里移除并不等于还显存 */
function releaseScratch(): void {
  for (const mesh of scratchMeshes) {
    scratchGroup?.remove(mesh)
    mesh.geometry.dispose()
  }
  scratchMeshes = []
}
