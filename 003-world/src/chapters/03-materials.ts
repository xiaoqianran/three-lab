import * as THREE from 'three'
import { createLabel } from '../core/Label'
import { createCanvasTexture } from '../core/texture'
import type { Chapter } from './types'

/**
 * 03 · 材质博物馆
 *
 * 同一形状（环面结）换成不同材质，差别一眼就能看出来。
 *
 * 材质本质上回答两个问题：
 *   1. 表面颜色从哪来？
 *      —— 直接用常量（Basic）、用顶点法线（Normal）、用深度（Depth）、
 *         用一张"球的照片"查表（Matcap）、还是真的和光做物理计算（Standard / Physical）。
 *   2. 和光的交互有多"讲究"？
 *      —— 完全不管光（Basic）、漫反射（Lambert）、加高光（Phong）、
 *         基于物理的金属度/粗糙度（Standard）、再加清漆/透射等高级层（Physical）。
 *
 * 记住一句话：**几何体决定形状，材质决定它怎么和光打交道**。
 */

interface Item {
  name: string
  material: THREE.Material
}

let items: Item[] = []
let labels: THREE.Sprite[] = []
/** 需要在 GUI 里实时改参数的材质引用 */
let standard: THREE.MeshStandardMaterial | null = null
let physical: THREE.MeshPhysicalMaterial | null = null

/** 假 matcap：matcap 材质拿"一个球被照亮的照片"当光照查表，所以画个圆形渐变就能骗过去 */
function createMatcap(): THREE.CanvasTexture {
  return createCanvasTexture(256, 256, (ctx, size) => {
    const gradient = ctx.createRadialGradient(
      size * 0.34, size * 0.3, size * 0.04,
      size * 0.5, size * 0.5, size * 0.66,
    )
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.22, '#a9c8ff')
    gradient.addColorStop(0.58, '#38477f')
    gradient.addColorStop(1, '#070a12')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  })
}

/** 阶梯明暗：MeshToonMaterial 用一张 1×3 的查找表把光照切成三档 */
function createToonGradient(): THREE.DataTexture {
  const data = new Uint8Array([40, 140, 255])
  const texture = new THREE.DataTexture(data, 3, 1, THREE.RedFormat)
  texture.needsUpdate = true
  return texture
}

export const materials: Chapter = {
  id: '03-materials',
  title: '材质博物馆',
  summary:
    '同一个环面结，九种材质排排站：不受光的 Basic/Normal/Depth/Matcap，和受光的 Lambert/Phong/Standard/Physical/Toon。顺带用 ShadowMaterial 做一块"只显示阴影"的接影布 —— 这是做产品级地面时最常用的一招。',
  apis: [
    'MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshStandardMaterial',
    'MeshPhysicalMaterial', 'MeshToonMaterial', 'MeshNormalMaterial', 'MeshDepthMaterial',
    'MeshMatcapMaterial', 'ShadowMaterial', 'DataTexture', 'flatShading',
  ],
  files: ['src/chapters/03-materials.ts', 'src/core/texture.ts', 'src/core/Label.ts'],
  camera: { radius: 16, theta: 0.5, phi: 1.02, target: [0, 1.5, 0] },

  build({ world, scene }) {
    // 接影布：ShadowMaterial 平时完全透明，只有被光照到阴影的地方才显示颜色
    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.ShadowMaterial({ color: 0x000814, opacity: 0.62 }),
    )
    shadowFloor.rotation.x = -Math.PI / 2
    shadowFloor.position.y = 0.002
    shadowFloor.receiveShadow = true
    world.add(shadowFloor)
    world.grid(26, 26)

    // ---- 光照：受光材质全靠它们 ----
    const ambient = new THREE.AmbientLight(0x8fa3cc, 1.15)
    const key = new THREE.DirectionalLight(0xfff3e2, 2.4)
    key.position.set(6, 9, 7)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 40
    key.shadow.camera.left = -12
    key.shadow.camera.right = 12
    key.shadow.camera.top = 12
    key.shadow.camera.bottom = -12
    // 阴影贴图每像素覆盖的面积变大了，bias 要跟着调，否则会出现自阴影条纹
    key.shadow.bias = -0.0009
    key.shadow.normalBias = 0.03
    key.shadow.camera.updateProjectionMatrix()

    const rim = new THREE.DirectionalLight(0x6f8dff, 1.1)
    rim.position.set(-7, 5, -6)

    // 点光源专门用来在光滑材质上点出高光
    const highlight = new THREE.PointLight(0xffd2a0, 26, 24, 2)
    highlight.position.set(-2.5, 3.4, 3.2)

    for (const light of [ambient, key, rim, highlight]) scene.add(light)

    // 点光源在画面里是看不见的，用一个自发光的球把它"标"出来
    highlightLight = highlight
    highlightBulb = world.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd2a0 }),
      ),
    )
    highlightBulb.position.copy(highlight.position)

    // ---- 九种材质 ----
    // 几何体只做一次，所有材质共用 —— 差别全部来自材质
    const geometry = new THREE.TorusKnotGeometry(0.62, 0.22, 160, 28)
    const matcap = createMatcap()

    standard = new THREE.MeshStandardMaterial({ color: 0xc9d6ff, roughness: 0.28, metalness: 0.85 })
    physical = new THREE.MeshPhysicalMaterial({
      color: 0xffd0e0,
      roughness: 0.22,
      metalness: 0.0,
      // clearcoat：在表面再叠一层"清漆"，汽车漆 / 手机玻璃就靠它
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      reflectivity: 1,
    })

    items = [
      { name: 'MeshBasicMaterial', material: new THREE.MeshBasicMaterial({ color: 0x7fb2ff }) },
      { name: 'MeshLambertMaterial', material: new THREE.MeshLambertMaterial({ color: 0x88e0b0 }) },
      {
        name: 'MeshPhongMaterial',
        material: new THREE.MeshPhongMaterial({ color: 0xffe08a, shininess: 90, specular: 0xcfe0ff }),
      },
      { name: 'MeshStandardMaterial', material: standard },
      { name: 'MeshPhysicalMaterial', material: physical },
      { name: 'MeshToonMaterial', material: new THREE.MeshToonMaterial({ color: 0xff9fb8, gradientMap: createToonGradient() }) },
      { name: 'MeshNormalMaterial', material: new THREE.MeshNormalMaterial() },
      { name: 'MeshDepthMaterial', material: new THREE.MeshDepthMaterial() },
      { name: 'MeshMatcapMaterial', material: new THREE.MeshMatcapMaterial({ matcap }) },
    ]

    labels = []
    items.forEach((item, index) => {
      const column = index % 3
      const row = Math.floor(index / 3)

      const mesh = new THREE.Mesh(geometry, item.material)
      mesh.position.set((column - 1) * 3.9, 1.6, (row - 1) * 3.6)
      mesh.castShadow = true
      mesh.receiveShadow = true
      world.add(mesh)

      const label = createLabel(item.name, { size: 0.32 })
      label.position.set(mesh.position.x, mesh.position.y + 1.5, mesh.position.z)
      world.add(label)
      labels.push(label)
    })

    // ---- 本章参数 ----
    const params = {
      金属度: 0.85,
      粗糙度: 0.28,
      清漆: 1,
      平面着色: false,
      显示标签: true,
    }

    const folder = world.folder('第 03 章')
    folder
      .add(params, '金属度', 0, 1, 0.01)
      .name('金属度 (Standard)')
      .onChange((v: number) => syncStandard(v, null))
    folder
      .add(params, '粗糙度', 0, 1, 0.01)
      .name('粗糙度 (Standard)')
      .onChange((v: number) => syncStandard(null, v))
    folder
      .add(params, '清漆', 0, 1, 0.01)
      .name('清漆 (Physical)')
      .onChange((v: number) => {
        if (physical) physical.clearcoat = v
      })
    folder
      .add(params, '平面着色')
      .name('平面着色 flatShading')
      .onChange((v: boolean) => {
        // flatShading 会改变着色器里的宏，改完必须让它重新编译
        for (const item of items) {
          const toggleable = item.material as THREE.Material & { flatShading?: boolean }
          if (typeof toggleable.flatShading !== 'boolean') continue
          toggleable.flatShading = v
          item.material.needsUpdate = true
        }
      })
    folder
      .add(params, '显示标签')
      .name('显示标签')
      .onChange((v: boolean) => labels.forEach((label) => (label.visible = v)))
  },

  update(dt) {
    // 让点光源绕场一周：高光沿着表面滑动，最容易看出"材质在跟光交互"
    if (!highlightLight) return
    orbitAngle += dt * 0.45
    highlightLight.position.set(Math.cos(orbitAngle) * 6.5, 3.2, Math.sin(orbitAngle) * 6.5)
    highlightBulb?.position.copy(highlightLight.position)
  },
}

let orbitAngle = 0
let highlightLight: THREE.PointLight | null = null
let highlightBulb: THREE.Mesh | null = null

function syncStandard(metalness: number | null, roughness: number | null): void {
  if (!standard) return
  if (metalness !== null) standard.metalness = metalness
  if (roughness !== null) standard.roughness = roughness
}
