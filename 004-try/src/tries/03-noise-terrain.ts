import * as THREE from 'three'
import { rand } from '../core/kit'
import type { World } from '../core/World'
import type { Try } from './types'

/**
 * 03 · 推一块地形
 *
 * 地形的本质非常简单：拿一张平面，给每个顶点算一个高度、改它的 y。
 * 所谓"噪声"就是那个高度函数 —— 这里用几层正弦叠加（频率翻倍、幅度减半），
 * 也就是最朴素的 fBm 分形噪声：便宜、够用、而且看得懂。
 *
 * 两个容易踩的坑：
 *   · 改完顶点位置必须 computeVertexNormals()，否则光照还是"平面"的，山看起来是平的；
 *   · 想按高度上色，就得自己写一份 color 顶点属性，并让材质 vertexColors: true。
 */

const SIZE = 60
const SEGMENTS = 120
const TREE_COUNT = 14

let terrain: THREE.Mesh | null = null
let terrainMaterial: THREE.MeshStandardMaterial | null = null
let trees: THREE.Object3D[] = []
let infoController: { updateDisplay(): unknown } | null = null

const params = { 起伏: 5, 频率: 0.09, 层数: 3, 平面着色: false, 显示树: true }
const info = { 顶点数: 0 }

/**
 * 高度函数：输入平面坐标，输出该点的高度。
 * 结果永远是 0 ~ 起伏，山谷正好贴在地面（y=0）上 —— 这是高度图最常用的约定，
 * 好处是地形不会陷到参考网格下面去。
 */
function height(x: number, z: number): number {
  let value = 0
  let amplitude = 1
  let frequency = params.频率
  let total = 0

  const layers = Math.round(params.层数)
  for (let i = 0; i < layers; i++) {
    // 每加一层：频率翻倍、幅度减半 —— 这就是 fBm（分形布朗运动）的做法
    value += Math.sin(x * frequency + i * 1.7) * Math.cos(z * frequency * 1.13 - i * 0.9) * amplitude
    total += amplitude
    amplitude *= 0.5
    frequency *= 2.1
  }

  // value / total 落在 -1~1，映射到 0~1 之后再乘上起伏高度
  return (value / total) * 0.5 * params.起伏 + params.起伏 * 0.5
}

export const terrainTry: Try = {
  id: '03-noise-terrain',
  title: '推一块地形',
  summary:
    '一张 120×120 分段的平面，按高度函数改每个顶点的 y，再按高度给顶点上色。旁边那几棵树用同一个高度函数贴到地表上 —— 这才是"地形是真的"的直观证据。',
  hint: '改 height() 里的公式（比如只留一层 sin），或者打开「平面着色 flatShading」，三角面会立刻显形。',
  tags: ['PlaneGeometry', 'position 属性', '顶点色', 'computeVertexNormals', 'flatShading'],
  files: ['src/tries/03-noise-terrain.ts'],
  camera: { radius: 46, theta: 0.62, phi: 1.02, target: [0, 2, 0] },

  build({ world }) {
    // 网格铺在 y=0：地形最低处就贴在这一层上，所以它只会在四周露出一圈"底板"
    world.grid(70, 70)
    world.lights({ key: 2.2, fill: 0.45, ambient: 0.55, keyPosition: [16, 22, 12] })

    terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
    })

    // 地形与树都只造一次，之后改参数只是"换一份几何体"
    terrain = world.add(new THREE.Mesh(buildGeometry(), terrainMaterial))
    terrain.castShadow = true
    terrain.receiveShadow = true
    info.顶点数 = terrain.geometry.attributes.position.count

    buildTrees(world)
    applyHeights()

    const folder = world.folder('03 · 地形')
    folder.add(params, '起伏', 0, 14, 0.1).name('起伏高度').onFinishChange(() => rebuild())
    folder.add(params, '频率', 0.02, 0.4, 0.005).name('基础频率').onFinishChange(() => rebuild())
    folder.add(params, '层数', 1, 6, 1).name('噪声层数').onFinishChange(() => rebuild())
    folder
      .add(params, '平面着色')
      .name('平面着色 flatShading')
      .onChange((v: boolean) => {
        // flatShading 会改变着色器里的宏，改完必须让它重新编译
        if (!terrainMaterial) return
        terrainMaterial.flatShading = v
        terrainMaterial.needsUpdate = true
      })
    folder
      .add(params, '显示树')
      .name('显示树')
      .onChange((v: boolean) => trees.forEach((tree) => (tree.visible = v)))
    infoController = folder.add(info, '顶点数').disable()
  },

  update(dt, elapsed) {
    // 树随风轻轻摆一下 —— 静态地形里加一点动，空间感会强很多
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i]
      tree.rotation.z = Math.sin(elapsed * 0.9 + i) * 0.04
      tree.rotation.x = Math.cos(elapsed * 0.7 + i * 1.3) * 0.03
    }
    void dt
  },

  dispose() {
    terrain = null
    terrainMaterial = null
    trees = []
    infoController = null
  },
}

/** 造一份地形几何体：改 y + 写顶点色 + 重算法线 */
function buildGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS)
  // ★ 先把平面转平：这样 position 里的 (x, z) 就是世界坐标，改 y 就等于改高度
  geometry.rotateX(-Math.PI / 2)

  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  const color = new THREE.Color()
  // 起伏为 0 时不能拿它当除数
  const range = Math.max(params.起伏, 0.001)

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    const y = height(x, z)
    position.setY(i, y)

    // 按高度上色：低处深蓝绿、中段草绿、高处偏白
    const t = THREE.MathUtils.clamp(y / range, 0, 1)
    color.setHSL(0.58 - t * 0.5, 0.42 + t * 0.16, 0.12 + t * 0.5)
    // ★ 顶点色属性是按**线性色**参与光照计算的，
    //   而我们挑颜色时心里想的是 sRGB（屏幕上看到的那个颜色）。
    //   少了这一步转换，地形会明显偏亮、发白。
    color.convertSRGBToLinear()
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  position.needsUpdate = true
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  // 顶点动过位置，法线必须重算，否则光照还按原来的平面法线算
  geometry.computeVertexNormals()
  return geometry
}

function buildTrees(world: World): void {
  // 树干 + 树冠两个几何体，14 棵树共用 —— 共享几何体是省显存的第一步
  const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.22, 1.6, 8)
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a34, roughness: 0.9 })
  const leafGeometry = new THREE.ConeGeometry(1.1, 3.2, 12)
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.8, flatShading: true })

  trees = []
  for (let i = 0; i < TREE_COUNT; i++) {
    const tree = new THREE.Group()

    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial)
    trunk.position.y = 0.8
    trunk.castShadow = true

    const leaves = new THREE.Mesh(leafGeometry, leafMaterial)
    leaves.position.y = 3
    leaves.castShadow = true

    tree.add(trunk, leaves)
    // 先把 xz 挑好，等高度算出来再贴到地表（见 applyHeights）
    tree.userData.at = new THREE.Vector2(rand(-24, 24), rand(-24, 24))
    world.add(tree)
    trees.push(tree)
  }
}

/** 用地形的高度函数把树放到地表上 */
function applyHeights(): void {
  for (const tree of trees) {
    const at = tree.userData.at as THREE.Vector2
    tree.position.set(at.x, height(at.x, at.y) - 0.3, at.y)
    tree.visible = params.显示树
  }
}

/** 参数变了：换一份几何体，旧的立刻还回显存 */
function rebuild(): void {
  if (!terrain) return
  const next = buildGeometry()
  terrain.geometry.dispose()
  terrain.geometry = next
  info.顶点数 = next.attributes.position.count
  infoController?.updateDisplay()
  applyHeights()
}
