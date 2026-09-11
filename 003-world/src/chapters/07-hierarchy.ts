import * as THREE from 'three'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 07 · 层级与变换（太阳系）
 *
 * 场景图是一棵树，每个 Object3D 都有自己的**局部坐标系**，
 * 它最终显示在哪，等于"自己 + 所有祖先"的变换层层相乘（local × parent × ... = world）。
 * 这一层套娃关系是 three.js 里最重要的一件事：
 *
 *   太阳系(Group)
 *     └ 行星轨道(Group，绕 Y 旋转 = 公转)
 *          └ 行星(位置在 (半径,0,0)，自己再绕 Y 转 = 自转)
 *               └ 卫星轨道(Group) → 卫星
 *
 * 好处是：你只管转"行星轨道"这一个 Group，整条公转轨迹上的所有东西都跟着走，
 * 完全不需要自己算三角函数。
 *
 * 同时也要注意局部坐标与世界坐标的区别 —— 面板上会实时显示同一个物体的两套坐标。
 */

interface PlanetRig {
  orbit: THREE.Group
  mesh: THREE.Mesh
  speed: number
  /** 公转半径，用来更新那根"世界坐标箭头" */
  radius: number
  name: string
}

let root: THREE.Group | null = null
let planets: PlanetRig[] = []
let labelSprites: THREE.Sprite[] = []
let orbitLines: THREE.Object3D[] = []
let arrow: THREE.ArrowHelper | null = null
/** 被箭头盯住的那颗行星（带卫星的那颗） */
let tracked: THREE.Mesh | null = null
let worldPosition = new THREE.Vector3()
let params = { 公转速度: 1, 显示轨道: true, 显示标签: true, 显示世界坐标: true }

export const hierarchy: Chapter = {
  id: '07-hierarchy',
  title: '层级与变换（太阳系）',
  summary:
    '用 Group 的嵌套把公转、自转、卫星轨道一次做对：转一个父节点，整串子节点跟着走。面板上会实时打出某颗行星的"局部坐标"和"世界坐标"—— 前者永远是常数，后者在变，这就是两套坐标系的关系。',
  apis: [
    'Group', 'Object3D.add', 'position / rotation / scale', 'getWorldPosition', 'matrixWorld',
    'lookAt', 'LineLoop', 'setFromPoints', 'ArrowHelper', 'scene.background',
  ],
  files: ['src/chapters/07-hierarchy.ts', 'src/core/Label.ts'],
  camera: { radius: 30, theta: 0.62, phi: 0.92, target: [0, 0.5, 0] },

  build({ world, scene }) {
    scene.background = new THREE.Color(0x05070f)

    // 按 R 重置时 build 会再跑一遍，这些引用要先清空，否则会指向上一批已经释放的对象
    planets = []
    labelSprites = []
    orbitLines = []
    antennas = []

    root = new THREE.Group()
    world.add(root)

    // ---- 太阳 ----
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 48, 32),
      // 不受光材质 = 自发光的效果；真正的"发光"要靠第 14 章的后处理
      new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    )
    root.add(sun)

    // 点光源放在太阳位置，行星被它照亮，明暗交界线会自然出现
    const sunLight = new THREE.PointLight(0xffd9a0, 900, 120, 2)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.set(1024, 1024)
    sunLight.shadow.bias = -0.003
    root.add(sunLight)

    root.add(new THREE.AmbientLight(0x39456b, 0.8))

    const sunLabel = createLabel('太阳 · 光源在原点', { size: 0.7 })
    sunLabel.position.set(0, 3.2, 0)
    root.add(sunLabel)
    labelSprites.push(sunLabel)

    // ---- 行星 ----
    const definitions = [
      { name: '水星', radius: 5.2, size: 0.42, color: 0xb9c2d8, speed: 1.6, tilt: 0.02 },
      { name: '金星', radius: 7.4, size: 0.62, color: 0xffcf8a, speed: 1.15, tilt: 0.05 },
      { name: '地球', radius: 10, size: 0.78, color: 0x7fb2ff, speed: 0.85, tilt: 0.41, moon: true },
      { name: '火星', radius: 13, size: 0.52, color: 0xff8a6b, speed: 0.62, tilt: 0.44 },
      { name: '土星', radius: 17, size: 1.05, color: 0xf0d9a0, speed: 0.4, tilt: 0.47, ring: true },
    ]

    for (const definition of definitions) {
      // 轨道 Group：它的 rotation.y 就是"公转角度"
      const orbit = new THREE.Group()
      root.add(orbit)

      // 行星本体：位置固定在 (半径, 0, 0)，所以它一定在轨道圈上
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(definition.size, 32, 24),
        new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.62, metalness: 0.08 }),
      )
      mesh.position.set(definition.radius, 0, 0)
      // 轴倾角：绕 Z 轴歪一点，自转看起来就不像在"绕着竖直轴打转"
      mesh.rotation.z = definition.tilt
      mesh.castShadow = true
      mesh.receiveShadow = true
      orbit.add(mesh)

      // 轨道线：拿一圈点连成 LineLoop。setFromPoints 是最省事的构造 BufferGeometry 的方式
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= 128; i++) {
        const angle = (i / 128) * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(angle) * definition.radius, 0, Math.sin(angle) * definition.radius))
      }
      const orbitLine = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x3b4c78, transparent: true, opacity: 0.7 }),
      )
      orbit.add(orbitLine)
      orbitLines.push(orbitLine)

      // 土星环：RingGeometry 是平的圆环，转 90° 放平即可
      if (definition.ring) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(definition.size * 1.5, definition.size * 2.4, 96),
          new THREE.MeshStandardMaterial({
            color: 0xe6d5a8,
            roughness: 0.7,
            side: THREE.DoubleSide,
          }),
        )
        ring.rotation.x = -Math.PI / 2
        // 跟着行星一起倾，观感更真实
        ring.rotation.y = definition.tilt
        mesh.add(ring)
      }

      // 卫星：再套一层 Group，它的旋转就是"卫星公转"
      if (definition.moon) {
        const moonOrbit = new THREE.Group()
        // 让卫星轨道面稍微歪一点，不然会一直和行星重叠
        moonOrbit.rotation.z = 0.32
        mesh.add(moonOrbit)

        const moon = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 24, 16),
          new THREE.MeshStandardMaterial({ color: 0xd8d8e8, roughness: 0.8 }),
        )
        moon.position.set(1.9, 0, 0)
        moon.castShadow = true
        moonOrbit.add(moon)

        // 天线：让一个柱体"永远指向太阳"。
        // 注意两点：
        //   1. Object3D.lookAt 接收的是**世界坐标**，three 内部会用父节点的逆矩阵换算回局部空间；
        //   2. 对非相机物体，lookAt 把物体的 +Z 轴对准目标，所以几何体要先转到 +Z 朝上。
        const antennaGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8)
        antennaGeometry.rotateX(Math.PI / 2)
        const antenna = new THREE.Mesh(
          antennaGeometry,
          new THREE.MeshStandardMaterial({ color: 0xff6b8a, emissive: 0x551122 }),
        )
        antenna.position.y = definition.size + 0.6
        mesh.add(antenna)
        antennas.push(antenna)

        tracked = mesh
      }

      const label = createLabel(definition.name, { size: 0.44 })
      label.position.set(definition.radius, definition.size + 0.55, 0)
      orbit.add(label)
      labelSprites.push(label)

      planets.push({
        orbit,
        mesh,
        speed: definition.speed,
        radius: definition.radius,
        name: definition.name,
      })
    }

    // ---- 世界坐标箭头：从原点指向被跟踪的行星 ----
    arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 10, 0x8affc0, 1, 0.5)
    root.add(arrow)

    // ---- 本章参数 ----
    const folder = world.folder('第 07 章')
    folder.add(params, '公转速度', 0, 4, 0.05).name('公转速度')
    folder
      .add(params, '显示轨道')
      .name('显示轨道线')
      .onChange((v: boolean) => orbitLines.forEach((line) => (line.visible = v)))
    folder
      .add(params, '显示标签')
      .name('显示标签')
      .onChange((v: boolean) => labelSprites.forEach((label) => (label.visible = v)))
    folder
      .add(params, '显示世界坐标')
      .name('世界坐标箭头')
      .onChange((v: boolean) => {
        if (arrow) arrow.visible = v
      })

    // 两个"只读"格子：局部坐标恒定、世界坐标在变
    folder.add(coords, '局部坐标').disable()
    folder.add(coords, '世界坐标').disable()
  },

  update(dt) {
    if (!root) return

    for (const planet of planets) {
      // 公转：只转这个 Group，行星、卫星、轨道上的标签全都跟着走
      planet.orbit.rotation.y += dt * planet.speed * params.公转速度 * 0.5
      // 自转：转行星本体，不影响它的位置
      planet.mesh.rotation.y += dt * 1.6
    }

    // 天线永远朝太阳：lookAt 用的是世界坐标，父节点在转也不影响
    for (const antenna of antennas) antenna.lookAt(0, 0, 0)

    // 局部坐标 vs 世界坐标
    if (tracked) {
      tracked.getWorldPosition(worldPosition)
      coords.局部坐标 = format(tracked.position)
      coords.世界坐标 = format(worldPosition)

      if (arrow && arrow.visible) {
        const distance = worldPosition.length()
        arrow.setDirection(worldPosition.clone().normalize())
        arrow.setLength(distance, 1.1, 0.5)
      }
    }
  },

  dispose() {
    root = null
    planets = []
    labelSprites = []
    orbitLines = []
    antennas = []
    arrow = null
    tracked = null
  },
}

let antennas: THREE.Object3D[] = []
/** 面板上的只读坐标显示 */
const coords = { 局部坐标: '-', 世界坐标: '-' }

function format(vector: THREE.Vector3): string {
  return `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`
}
