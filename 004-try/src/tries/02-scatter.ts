import * as THREE from 'three'
import { mat, pick, rand } from '../core/kit'
import type { World } from '../core/World'
import type { Try } from './types'

/**
 * 02 · 随手撒东西
 *
 * 把鼠标"贴"进三维世界，靠两件事：
 *   1. 屏幕坐标 → NDC（-1~1，注意 y 要翻转）；
 *   2. 从相机朝这个方向射一条射线，求它与 y=0 这个数学平面的交点。
 *
 * 用数学平面（THREE.Plane）而不是去射地面网格，好处是稳定：
 * 不管地面上有没有别的东西挡着，交点一定在水平面上，而且几乎不花性能。
 *
 * 右键删除走的是另一条路：射线去打"已经放下的那些物体"，
 * 取最近的那个 —— 这才是射线拾取最常见的用法。
 */

/** 每次点击随机挑一种几何体 */
const SHAPES: Array<() => THREE.BufferGeometry> = [
  () => new THREE.BoxGeometry(1, 1, 1),
  () => new THREE.SphereGeometry(0.6, 32, 24),
  () => new THREE.ConeGeometry(0.6, 1.3, 24),
  () => new THREE.TorusGeometry(0.5, 0.2, 16, 40),
  () => new THREE.IcosahedronGeometry(0.65, 0),
  () => new THREE.CapsuleGeometry(0.35, 0.6, 8, 16),
]

const COLORS = ['#ff8a8a', '#ffc97a', '#ffe98a', '#8ae9c0', '#8ad4ff', '#b08aff']

/** 放太多会掉帧，也给显存留点余地 */
const MAX_PLACED = 240

let placed: THREE.Object3D[] = []
let raycaster: THREE.Raycaster | null = null
let cameraRef: THREE.PerspectiveCamera | null = null
let onDown: ((event: PointerEvent) => void) | null = null
let countController: { updateDisplay(): unknown } | null = null

const pointer = new THREE.Vector2()
/** y = 0 的水平面 */
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hitPoint = new THREE.Vector3()

const params = { 尺寸: 1 }
const info = { 数量: 0 }

export const scatterTry: Try = {
  id: '02-scatter',
  title: '随手撒东西',
  summary:
    '左键点地面 → 在那儿长出一个随机形状；右键点它 → 删掉。射线拾取是"看见的东西能摸到"的全部秘密，交点、距离、法线都在 intersect 的返回值里。',
  hint: '改 SHAPES 里的几何体列表；把「尺寸」拉大；或者把颜色改成按点击次数分段取色（提示：用 placed.length）。',
  tags: ['Raycaster', 'Plane', 'NDC 换算', 'intersectObjects', 'dispose'],
  files: ['src/tries/02-scatter.ts'],
  camera: { radius: 16, theta: 0.55, phi: 0.96, target: [0, 1, 0] },

  build({ world, renderer, view }) {
    world.ground(70)
    world.grid(30, 30)
    world.lights()

    raycaster = new THREE.Raycaster()
    cameraRef = view.camera

    // 事件挂在 canvas 上，离开试验时必须摘掉（见 dispose）
    onDown = (event: PointerEvent) => {
      updateRay(event)
      if (!raycaster) return

      if (event.button === 0) {
        // 左键：射线与 y=0 平面的交点
        if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return
        spawn(world, hitPoint.clone())
      } else if (event.button === 2) {
        // 右键：打中的第一个物体就是最近的，删掉它
        const first = raycaster.intersectObjects(placed, false)[0]
        if (first) removeAt(world, first.object)
      }
    }

    renderer.domElement.addEventListener('pointerdown', onDown)

    const folder = world.folder('02 · 随手撒')
    folder.add(params, '尺寸', 0.4, 3, 0.05).name('新物体尺寸')
    folder
      .add(
        {
          清空: () => {
            for (const object of [...placed]) removeAt(world, object)
          },
        },
        '清空',
      )
      .name('清空全部')
    countController = folder.add(info, '数量').disable()

    // 摆几个初始的，一进来就能看到效果
    for (let i = 0; i < 7; i++) {
      spawn(world, new THREE.Vector3(rand(-6, 6), 0, rand(-6, 6)))
    }
  },

  update(_dt, elapsed) {
    // 让放下去的东西轻轻浮动，一眼能看出它们是"活"的
    for (let i = 0; i < placed.length; i++) {
      const object = placed[i]
      const baseY = (object.userData.baseY as number) ?? 0
      object.position.y = baseY + Math.sin(elapsed * 1.3 + i * 0.7) * 0.07
      object.rotation.y += 0.004
    }
  },

  dispose({ renderer }) {
    if (onDown) renderer.domElement.removeEventListener('pointerdown', onDown)
    placed = []
    raycaster = null
    cameraRef = null
    onDown = null
    countController = null
  },
}

/** 屏幕坐标 → NDC → 从相机射出的一条射线 */
function updateRay(event: PointerEvent): void {
  if (!raycaster || !cameraRef) return
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointer, cameraRef)
}

function spawn(world: World, position: THREE.Vector3): void {
  const size = params.尺寸
  const geometry = pick(SHAPES)()
  const mesh = new THREE.Mesh(geometry, mat(pick(COLORS)))

  // 想让物体"站"在平面上，得先知道它有多高 —— 让几何体自己算个包围盒最省事。
  // 包围盒是局部空间的，所以再乘上缩放才是真实高度。
  geometry.computeBoundingBox()
  const halfHeight = (geometry.boundingBox?.max.y ?? 0.5) * size

  mesh.scale.setScalar(size)
  mesh.position.set(position.x, halfHeight, position.z)
  mesh.rotation.y = rand(0, Math.PI)
  mesh.castShadow = true
  mesh.receiveShadow = true
  // 浮动动画要以"落地高度"为基准，先记下来
  mesh.userData.baseY = mesh.position.y

  world.add(mesh)
  placed.push(mesh)

  // 超出上限就把最早放的收走，别让场景无限膨胀
  if (placed.length > MAX_PLACED) removeAt(world, placed[0])

  info.数量 = placed.length
  countController?.updateDisplay()
}

function removeAt(world: World, object: THREE.Object3D): void {
  // World.remove 负责"从场景里拿走 + 把几何/材质还回显存"，两件事都不能省
  world.remove(object)
  placed = placed.filter((item) => item !== object)
  info.数量 = placed.length
  countController?.updateDisplay()
}
