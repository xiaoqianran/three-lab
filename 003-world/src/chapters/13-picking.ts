import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 13 · 射线拾取与交互
 *
 * 屏幕是二维的，鼠标只有 (x, y)。要"点到"三维物体，three.js 的做法是：
 *   1. 把鼠标坐标换算成 NDC（-1 ~ 1，注意 y 轴要翻转）；
 *   2. raycaster.setFromCamera(ndc, camera) 从相机往这个方向射出一条射线；
 *   3. intersectObjects 求出射线打中了哪些三角形，结果按距离由近到远排序。
 *
 * 返回的每一项都带着很有用的信息：
 *   .object   被击中的对象
 *   .point    世界坐标下的交点（"在点击处放个东西"就用它）
 *   .face     命中的三角面；face.normal 是**物体局部空间**的法线，要自己转成世界方向
 *   .distance 相机到交点的距离
 *   .uv       交点处的 uv
 *
 * 还有 Layers：每个 Object3D 和每个 Raycaster 都有 32 个位，
 * 两边都"点亮"同一个位才会参与 —— 做"只拾取某一类物体"最省事。
 */

let raycaster: THREE.Raycaster | null = null
let cameraRef: THREE.PerspectiveCamera | null = null

const pointer = new THREE.Vector2()
let pickables: THREE.Mesh[] = []
let marker: THREE.Mesh | null = null
let normalArrow: THREE.ArrowHelper | null = null
let transform: TransformControls | null = null
let hovered: THREE.Mesh | null = null
let warnedForCameraLayers = false
let downPoint: { x: number; y: number } | null = null
let infoController: { updateDisplay(): unknown } | null = null

const info = { 悬停对象: '-', 距离: '-', 交点: '-', 命中面: '-', 只拾取标记层: false, 变换模式: '平移' }
const params = { 相机只看标记层: false }

export const picking: Chapter = {
  id: '13-picking',
  title: '射线拾取与交互',
  summary:
    '鼠标划过物体 → 高亮，并在面板上打出命中对象、距离、交点坐标和面序号；点击 → 挂上 TransformControls 手柄，直接拖拽改位置 / 旋转 / 缩放（拖手柄时相机会自动让位）。再用 Layers 把两个物体放进第 1 层，演示"过滤掉一部分拾取目标"。',
  apis: [
    'Raycaster', 'setFromCamera', 'intersectObjects', 'intersection.point / face / distance / uv',
    'Layers', 'NDC 换算', 'TransformControls', 'dragging-changed', 'matrixWorld',
  ],
  files: ['src/chapters/13-picking.ts', 'src/core/Label.ts'],
  camera: { radius: 15, theta: 0.42, phi: 1.06, target: [0, 1.6, 0] },

  build({ world, scene, renderer, camera }) {
    world.ground(60)
    world.grid(24, 24)

    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(8, 13, 9)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -16
    key.shadow.camera.right = 16
    key.shadow.camera.top = 16
    key.shadow.camera.bottom = -16
    key.shadow.camera.far = 50
    key.shadow.camera.updateProjectionMatrix()
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2b3550, 1.2))

    // 拾取要用的三件套：射线器、相机、画布
    raycaster = new THREE.Raycaster()
    cameraRef = camera.camera

    // ---- 一排可拾取的物体 ----
    const geometries: THREE.BufferGeometry[] = [
      new THREE.BoxGeometry(1.5, 1.5, 1.5),
      new THREE.SphereGeometry(0.95, 32, 24),
      new THREE.TorusGeometry(0.75, 0.32, 20, 48),
      new THREE.ConeGeometry(0.9, 1.8, 24),
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.TorusKnotGeometry(0.55, 0.2, 128, 24),
      new THREE.CylinderGeometry(0.7, 0.7, 1.6, 24),
      new THREE.OctahedronGeometry(1, 0),
    ]
    const colors = [0xff8a8a, 0xffc97a, 0xffe98a, 0x8ae9c0, 0x8ad4ff, 0xb08aff, 0xff9fd6, 0x9fd6ff]

    pickables = geometries.map((geometry, index) => {
      const material = new THREE.MeshStandardMaterial({
        color: colors[index],
        roughness: 0.4,
        metalness: 0.2,
        // 高亮靠改 emissive；每个物体用独立材质，互不影响
        emissive: 0x000000,
      })
      const mesh = new THREE.Mesh(geometry, material)
      const column = index % 4
      const row = Math.floor(index / 4)
      mesh.position.set((column - 1.5) * 3.1, 1.5, (row - 0.5) * 3.6)
      mesh.castShadow = true
      mesh.receiveShadow = true
      // 最后两个同时属于 Layer 1（Layer 0 还在，所以两个图层里都看得见）
      if (index >= 6) mesh.layers.enable(1)

      mesh.userData.名字 = `第 ${index + 1} 号 · ${geometry.type}`
      mesh.name = `pick-${index}`
      world.add(mesh)
      return mesh
    })

    const layerLabel = createLabel('右边两个在 Layer 1', { size: 0.34 })
    layerLabel.position.set(5.2, 4.4, 1.8)
    world.add(layerLabel)

    // ---- 命中点标记：小球 + 法线箭头 ----
    marker = world.add(
      new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x8affc0 })),
    )
    marker.visible = false

    normalArrow = world.add(
      new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1.2, 0x8affc0, 0.35, 0.2),
    )
    normalArrow.visible = false

    // ---- TransformControls：选中后可以拖拽 ----
    // r169 起控件本身不再是 Object3D，要把它内部的 helper 加进场景
    transform = new TransformControls(camera.camera, renderer.domElement)
    world.add(transform.getHelper())

    // 拖手柄时把相机让开，否则它会跟轨道相机抢鼠标
    transform.addEventListener('dragging-changed', (event) => {
      camera.enabled = !event.value
    })

    // ---- 指针事件 ----
    // 监听挂在 canvas 上，切章时必须自己摘掉（见 dispose）
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    // ---- 面板 ----
    const folder = world.folder('第 13 章')
    infoController = folder.add(info, '悬停对象').disable()
    folder.add(info, '距离').disable()
    folder.add(info, '交点').disable()
    folder.add(info, '命中面').disable()
    folder
      .add(info, '只拾取标记层')
      .name('射线只拾取 Layer 1')
      .onChange((v: boolean) => {
        if (!raycaster) return
        // set() 会先清空再只留这一位；enableAll 恢复成"所有图层都拾取"
        if (v) raycaster.layers.set(1)
        else raycaster.layers.enableAll()
      })
    folder
      .add(params, '相机只看标记层')
      .name('相机只看 Layer 1')
      .onChange((v: boolean) => {
        // camera.layers 管"渲染谁"，raycaster.layers 管"能点到谁"，两者是独立的
        if (v) {
          camera.camera.layers.disable(0)
          camera.camera.layers.enable(1)
          if (!warnedForCameraLayers) {
            warnedForCameraLayers = true
            console.log('[13-picking] 相机现在只渲染 Layer 1，地面和其余物体都看不到了')
          }
        } else {
          camera.camera.layers.enable(0)
          camera.camera.layers.disable(1)
        }
      })
    folder
      .add(info, '变换模式', ['平移', '旋转', '缩放'])
      .name('手柄模式')
      .onChange((mode: string) => {
        transform?.setMode(mode === '旋转' ? 'rotate' : mode === '缩放' ? 'scale' : 'translate')
      })
  },

  dispose({ renderer, camera }) {
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)

    transform?.detach()
    transform?.disconnect()
    transform?.dispose()

    // 相机图层是个"全局开关"，用完要还原（默认只有 Layer 0）
    camera.camera.layers.mask = 1

    raycaster = null
    cameraRef = null
    transform = null
    marker = null
    normalArrow = null
    pickables = []
    hovered = null
    infoController = null
    warnedForCameraLayers = false
  },
}

// ---------------------------------------------------------------- 交互实现

function toNdc(event: PointerEvent): void {
  // 屏幕坐标 → NDC：x 从 0~width 映射到 -1~1；y 要翻转（屏幕 y 向下，NDC y 向上）
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
}

function pick(event: PointerEvent): THREE.Intersection | null {
  if (!raycaster || !cameraRef) return null
  toNdc(event)
  raycaster.setFromCamera(pointer, cameraRef)
  // 第二个参数 false = 不递归子节点；这些物体都是扁平的，不需要
  return raycaster.intersectObjects(pickables, false)[0] ?? null
}

function setHighlight(mesh: THREE.Mesh, on: boolean): void {
  const material = mesh.material as THREE.MeshStandardMaterial
  material.emissive.setHex(on ? 0x2b4fff : 0x000000)
}

function clearHoverInfo(): void {
  info.悬停对象 = '（空白处）'
  info.距离 = '-'
  info.交点 = '-'
  info.命中面 = '-'
  infoController?.updateDisplay()
}

const onPointerMove = (event: PointerEvent): void => {
  if (!marker || !normalArrow) return

  const hit = pick(event)

  if (!hit) {
    if (hovered) setHighlight(hovered, false)
    hovered = null
    marker.visible = false
    normalArrow.visible = false
    clearHoverInfo()
    return
  }

  const mesh = hit.object as THREE.Mesh
  if (hovered && hovered !== mesh) setHighlight(hovered, false)
  hovered = mesh
  setHighlight(mesh, true)

  marker.visible = true
  marker.position.copy(hit.point)
  normalArrow.visible = true
  normalArrow.position.copy(hit.point)

  if (hit.face) {
    // face.normal 是局部空间的法线；transformDirection 只做旋转，正好用来转方向
    const worldNormal = hit.face.normal.clone().transformDirection(mesh.matrixWorld)
    normalArrow.setDirection(worldNormal)
  }

  info.悬停对象 = String(mesh.userData.名字 ?? mesh.name)
  info.距离 = `${hit.distance.toFixed(2)} m`
  info.交点 = `(${hit.point.x.toFixed(2)}, ${hit.point.y.toFixed(2)}, ${hit.point.z.toFixed(2)})`
  info.命中面 = hit.face
    ? `#${hit.faceIndex} uv(${hit.uv?.x.toFixed(2) ?? '-'}, ${hit.uv?.y.toFixed(2) ?? '-'})`
    : '-'
  infoController?.updateDisplay()
}

const onPointerDown = (event: PointerEvent): void => {
  if (event.button !== 0) return
  downPoint = { x: event.clientX, y: event.clientY }
}

const onPointerUp = (event: PointerEvent): void => {
  if (event.button !== 0 || !downPoint) return

  // 拖动超过 6 像素当成"转相机"，不算点击
  const moved = Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y)
  downPoint = null
  if (moved > 6) return

  const hit = pick(event)
  if (hit && transform) {
    transform.attach(hit.object)
    console.log('[13-picking] 选中', hit.object.name, '交点', hit.point.toArray())
  } else {
    // 点空白处 = 取消选中
    transform?.detach()
  }
}
