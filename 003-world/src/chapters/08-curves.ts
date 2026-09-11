import * as THREE from 'three'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 08 · 曲线与几何生成
 *
 * three.js 里"形状"有两种来源：
 *   1. 内置参数化几何体（第 02 章）：给几个数字，它帮你生成顶点；
 *   2. 自己描述一条曲线 / 一个剖面 / 一个路径，再让它生成表面。
 *
 * 这一章就是第 2 种：
 *   Curve → TubeGeometry      沿曲线扫出一个管子（管道、缆绳、过山车轨道）
 *   Vector2 剖面 → LatheGeometry   绕 Y 轴旋成回转体（花瓶、杯子、柱子）
 *   Shape / Path → ExtrudeGeometry 平面图形挤出成体，可以挖洞（标牌、齿轮、字体）
 *   Shape / Path → ShapeGeometry   只要平面填充，不要厚度
 *
 * 曲线本身也很实用：getPointAt(t) 取位置、getTangentAt(t) 取方向，
 * 让物体"沿路径运动"就靠这两个方法（本章那个小球就是）。
 */

let flightCurve: THREE.CatmullRomCurve3 | null = null
let follower: THREE.Mesh | null = null
let tangentArrow: THREE.ArrowHelper | null = null
let travel = 0

export const curves: Chapter = {
  id: '08-curves',
  title: '曲线与几何生成',
  summary:
    '四种"让代码替你算顶点"的姿势：Catmull-Rom 过点曲线扫成管子、贝塞尔曲线做弧线、2D 剖面旋成花瓶、带洞的形状挤出成标牌。最后让一个小球沿着曲线跑，用切线箭头告诉你 getPointAt / getTangentAt 到底返回了什么。',
  apis: [
    'Curve', 'CatmullRomCurve3', 'QuadraticBezierCurve3', 'CubicBezierCurve3', 'getPointAt',
    'getTangentAt', 'TubeGeometry', 'LatheGeometry', 'ExtrudeGeometry', 'ShapeGeometry',
    'Shape', 'Path', 'LineDashedMaterial', 'computeLineDistances', 'setFromPoints',
  ],
  files: ['src/chapters/08-curves.ts', 'src/core/Label.ts'],
  camera: { radius: 30, theta: 0.24, phi: 1.04, target: [-2, 4, 0] },

  build({ world, scene }) {
    world.ground(90)
    world.grid(40, 40)

    const key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(12, 18, 10)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -26
    key.shadow.camera.right = 26
    key.shadow.camera.top = 26
    key.shadow.camera.bottom = -26
    key.shadow.camera.far = 70
    key.shadow.camera.updateProjectionMatrix()
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2b3550, 1.1))

    // ---- 1. Catmull-Rom：穿过所有控制点的光滑曲线 ----
    const controlPoints = [
      new THREE.Vector3(-15, 0.9, 7),
      new THREE.Vector3(-13, 3.6, 1.5),
      new THREE.Vector3(-15.5, 6.2, -4),
      new THREE.Vector3(-11, 2.6, -7.5),
      new THREE.Vector3(-6.5, 5.4, -3.5),
      new THREE.Vector3(-8.5, 7.8, 2.5),
      new THREE.Vector3(-4, 6.4, 7.5),
    ]
    // 第三个参数是曲线类型，第四个是张力（0.5 最接近圆滑的样条）
    flightCurve = new THREE.CatmullRomCurve3(controlPoints, false, 'catmullrom', 0.5)

    // 管子：沿曲线扫出一个圆截面。分段数越大越顺滑，也越费顶点
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(flightCurve, 260, 0.17, 12, false),
      new THREE.MeshStandardMaterial({
        color: 0x7fd4ff,
        roughness: 0.3,
        metalness: 0.4,
        transparent: true,
        opacity: 0.55,
      }),
    )
    world.add(tube)

    // 曲线本身画成虚线，从半透明的管子里透出来 —— 看清"管就是沿曲线扫出来的"
    const centerLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(flightCurve.getPoints(260)),
      new THREE.LineDashedMaterial({ color: 0xffe08a, dashSize: 0.4, gapSize: 0.28 }),
    )
    // 虚线材质必须调用它来算每段线的累计长度，否则 dash 不会出现
    centerLine.computeLineDistances()
    world.add(centerLine)

    // 控制点用小方块标出来
    const controlDots: THREE.Mesh[] = []
    const dotGeometry = new THREE.BoxGeometry(0.28, 0.28, 0.28)
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xffb0c0 })
    for (const point of controlPoints) {
      const dot = new THREE.Mesh(dotGeometry, dotMaterial)
      dot.position.copy(point)
      world.add(dot)
      controlDots.push(dot)
    }

    // 沿曲线跑的小球 + 切线箭头
    follower = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xff8a5c, emissive: 0x571a08, roughness: 0.35 }),
    )
    world.add(follower)
    tangentArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1.6, 0xff8a5c, 0.5, 0.28)
    world.add(tangentArrow)

    const catmullLabel = createLabel('CatmullRomCurve3 + TubeGeometry', { size: 0.52 })
    catmullLabel.position.set(-10.5, 9.4, 3)
    world.add(catmullLabel)

    // ---- 2. 贝塞尔曲线：不穿过控制点，而是被它们"拉过去" ----
    const quadratic = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-4.5, 1.1, 8),
      new THREE.Vector3(-1.5, 6.8, 8),
      new THREE.Vector3(2, 1.1, 8),
    )
    const cubic = new THREE.CubicBezierCurve3(
      new THREE.Vector3(-4.5, 1.1, 3.4),
      new THREE.Vector3(-2.8, 6.8, 3.4),
      new THREE.Vector3(0.4, 0.9, 3.4),
      new THREE.Vector3(2, 1.1, 3.4),
    )

    const bezierMaterial = new THREE.MeshStandardMaterial({ color: 0xa0f0c0, roughness: 0.35, metalness: 0.25 })
    world.add(new THREE.Mesh(new THREE.TubeGeometry(quadratic, 120, 0.13, 10, false), bezierMaterial))
    world.add(new THREE.Mesh(new THREE.TubeGeometry(cubic, 160, 0.13, 10, false), bezierMaterial))

    const quadraticLabel = createLabel('QuadraticBezierCurve3', { size: 0.42 })
    quadraticLabel.position.set(-1.2, 7.6, 8)
    world.add(quadraticLabel)
    const cubicLabel = createLabel('CubicBezierCurve3', { size: 0.42 })
    cubicLabel.position.set(-1.2, 7.6, 3.4)
    world.add(cubicLabel)

    // ---- 3. LatheGeometry：给一条 2D 剖面，绕 Y 轴旋一圈 ----
    // Vector2 的 x 是半径、y 是高度。前面几个点决定"肚子"，后面决定"收口"
    const profile: THREE.Vector2[] = []
    const steps = 30
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const radius = 0.5 + 0.8 * Math.sin(t * Math.PI * 0.85) + 0.14 * Math.sin(t * Math.PI * 5)
      profile.push(new THREE.Vector2(Math.max(radius, 0.1), t * 3.6))
    }

    const vase = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 64),
      new THREE.MeshStandardMaterial({
        color: 0x9fe8d8,
        roughness: 0.28,
        metalness: 0.3,
        // 旋转面是"没有盖子的壳"，只画正面会看到内部被剔除后的大洞
        side: THREE.DoubleSide,
      }),
    )
    vase.position.set(7.5, 0.05, 6)
    vase.castShadow = true
    world.add(vase)

    const vaseLabel = createLabel('LatheGeometry', { size: 0.46 })
    vaseLabel.position.set(7.5, 4.6, 6)
    world.add(vaseLabel)

    // ---- 4. ExtrudeGeometry：给一个平面形状，挤出厚度（可以挖洞）----
    const shape = new THREE.Shape()
    shape.moveTo(-1.5, -1.5)
    shape.lineTo(1.5, -1.5)
    shape.lineTo(1.5, 1.5)
    shape.lineTo(-1.5, 1.5)
    shape.closePath()

    // 洞要用 Path，而且绕向要和外轮廓相反，否则会出现"实心"的窟窿
    const hole = new THREE.Path()
    hole.absarc(0, 0, 0.62, 0, Math.PI * 2, true)
    shape.holes.push(hole)

    const extruded = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.55,
        bevelEnabled: true,
        bevelThickness: 0.14,
        bevelSize: 0.14,
        bevelSegments: 4,
        curveSegments: 24,
      }),
      new THREE.MeshStandardMaterial({ color: 0xffc98a, roughness: 0.4, metalness: 0.25 }),
    )
    extruded.position.set(7, 2.6, -3.5)
    extruded.rotation.y = -0.55
    extruded.castShadow = true
    world.add(extruded)

    // ---- 5. ShapeGeometry：同一个形状，只要平面填充 ----
    const flat = new THREE.Mesh(
      new THREE.ShapeGeometry(shape, 24),
      new THREE.MeshStandardMaterial({ color: 0xb08aff, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide }),
    )
    flat.position.set(11.6, 2.6, -3.5)
    flat.rotation.y = -0.55
    world.add(flat)

    const extrudeLabel = createLabel('ExtrudeGeometry', { size: 0.42 })
    extrudeLabel.position.set(7.6, 4.5, -3.5)
    world.add(extrudeLabel)
    const shapeLabel = createLabel('ShapeGeometry', { size: 0.42 })
    shapeLabel.position.set(12.4, 4.5, -3.5)
    world.add(shapeLabel)

    // ---- 本章参数 ----
    const folder = world.folder('第 08 章')
    folder.add(curveParams, '沿线速度', 0, 0.6, 0.01).name('小球沿线速度')
    folder
      .add({ 显示控制点: true }, '显示控制点')
      .name('显示控制点')
      .onChange((v: boolean) => controlDots.forEach((dot) => (dot.visible = v)))
    folder.add(tube.material, 'wireframe').name('管子线框')
  },

  update(dt) {
    if (!flightCurve || !follower || !tangentArrow) return

    // t 是"走完了曲线的百分之几"，getPointAt 按**弧长**参数化，
    // 所以速度看起来是匀速的（getPoint 走的是曲线参数，会在曲率大的地方变慢）
    travel = (travel + dt * curveParams.沿线速度) % 1

    const position = flightCurve.getPointAt(travel)
    const tangent = flightCurve.getTangentAt(travel)

    follower.position.copy(position)
    tangentArrow.position.copy(position)
    tangentArrow.setDirection(tangent.normalize())
  },

  dispose() {
    flightCurve = null
    follower = null
    tangentArrow = null
    travel = 0
  },
}

const curveParams = { 沿线速度: 0.16 }
