import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 04 · 光与影
 *
 * three.js 的光全是"解析光源"—— 没有光线追踪，每种灯在着色器里都是一条数学公式：
 *   AmbientLight     环境光：往所有方向均匀加一层亮度，没有方向也没有阴影
 *   HemisphereLight  半球光：天空色照上面、地面色照下面，做自然天光最省事
 *   DirectionalLight 平行光：太阳。光线平行，只有方向，阴影用正交投影
 *   PointLight       点光：灯泡。按距离平方衰减，阴影要渲染 6 个面（立方体贴图）
 *   SpotLight        聚光：手电筒。多两个参数，锥角 angle 与边缘柔和度 penumbra
 *   RectAreaLight    面光：灯管 / 柔光箱。最接近真实摄影棚，但**不产生阴影**
 *
 * 关于强度：three 现在用物理单位（点光/聚光是坎德拉），所以点光的强度动辄几十上百，
 * 而平行光只有个位数 —— 看到数字差别大别慌，这是对的。
 */

let orbitLight: THREE.PointLight | null = null
let orbitHelper: THREE.PointLightHelper | null = null
let orbitAngle = 0

export const lights: Chapter = {
  id: '04-lights',
  title: '光与影',
  summary:
    '六种光源各来一盏，球阵当"照度计"，柱子负责投出好看的长影子。阴影部分的重点是：只有平行光 / 点光 / 聚光能投影，投影本质是"从灯光视角再渲染一遍深度"，所以阴影相机（shadow.camera）的范围、贴图尺寸、bias 都会直接影响画面。',
  apis: [
    'AmbientLight', 'HemisphereLight', 'DirectionalLight', 'PointLight', 'SpotLight',
    'RectAreaLight', 'RectAreaLightUniformsLib', 'castShadow', 'shadow.camera', 'shadow.bias',
    'DirectionalLightHelper', 'PointLightHelper', 'SpotLightHelper', 'CameraHelper', 'PCFSoftShadowMap',
  ],
  files: ['src/chapters/04-lights.ts', 'src/core/Label.ts'],
  camera: { radius: 27, theta: 0.86, phi: 1.02, target: [0, 2.2, 0] },

  build({ world, scene, renderer }) {
    // RectAreaLight 需要一张"线性变换余弦"查找表，用它自带的方法生成（一次性）
    RectAreaLightUniformsLib.init()

    world.ground(80)
    world.grid(32, 32)

    // ---- 照度计：球阵 ----
    const sphereGeometry = new THREE.SphereGeometry(0.42, 24, 16)
    const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0xe2e8ff, roughness: 0.45, metalness: 0.08 })

    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 8; column++) {
        const ball = new THREE.Mesh(sphereGeometry, sphereMaterial)
        ball.position.set((column - 3.5) * 1.9, 0.45, (row - 2) * 1.9)
        ball.castShadow = true
        ball.receiveShadow = true
        world.add(ball)
      }
    }

    // ---- 阴影制造机：三根柱子，把阴影拉长到画面里 ----
    const pillarGeometry = new THREE.BoxGeometry(0.9, 3.4, 0.9)
    const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x8394c4, roughness: 0.6, metalness: 0.2 })
    for (let i = 0; i < 3; i++) {
      const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial)
      pillar.position.set((i - 1) * 4.6, 1.7, -5.2)
      pillar.castShadow = true
      pillar.receiveShadow = true
      world.add(pillar)
    }

    // ---- 1. 环境光：兜底亮度，避免背光面死黑 ----
    const ambient = new THREE.AmbientLight(0x44527a, 0.75)
    scene.add(ambient)

    // ---- 2. 半球光：天空给冷色，地面反射给暖色 ----
    const hemisphere = new THREE.HemisphereLight(0xa9caff, 0x2b3550, 0.7)
    hemisphere.position.set(0, 12, 0)
    scene.add(hemisphere)

    // ---- 3. 平行光：主角，负责主阴影 ----
    const key = new THREE.DirectionalLight(0xfff2dd, 2.4)
    key.position.set(11, 14, 9)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    // 阴影相机是正交相机：范围要刚好罩住"会投影的区域"，太大则每像素覆盖面积变大、阴影发糊
    key.shadow.camera.near = 1
    key.shadow.camera.far = 60
    key.shadow.camera.left = -18
    key.shadow.camera.right = 18
    key.shadow.camera.top = 18
    key.shadow.camera.bottom = -18
    key.shadow.bias = -0.0008
    key.shadow.normalBias = 0.04
    // 改完阴影相机的参数必须重算投影矩阵，否则还是默认的 10×10 范围
    key.shadow.camera.updateProjectionMatrix()
    scene.add(key)
    scene.add(key.target)

    const keyHelper = new THREE.DirectionalLightHelper(key, 1.4, 0xffd9a0)
    scene.add(keyHelper)
    // CameraHelper 直接把阴影相机的视锥画出来，调 shadow.camera 时非常好用
    const shadowCameraHelper = new THREE.CameraHelper(key.shadow.camera)
    shadowCameraHelper.visible = false
    scene.add(shadowCameraHelper)

    // ---- 4. 点光：绕场跑，顺便展示"点光阴影要渲 6 个面" ----
    const point = new THREE.PointLight(0xff8a5c, 42, 24, 2)
    point.position.set(0, 4, 0)
    point.castShadow = true
    point.shadow.mapSize.set(1024, 1024)
    point.shadow.camera.near = 0.3
    point.shadow.camera.far = 26
    point.shadow.bias = -0.004
    scene.add(point)
    orbitLight = point
    orbitHelper = new THREE.PointLightHelper(point, 0.4, 0xff8a5c)
    scene.add(orbitHelper)

    // ---- 5. 聚光：从侧后方打，penumbra 控制光斑边缘的柔度 ----
    const spot = new THREE.SpotLight(0x88b4ff, 160, 40, 0.42, 0.6, 1.8)
    spot.position.set(-11, 12, -9)
    spot.castShadow = true
    spot.shadow.mapSize.set(1024, 1024)
    spot.shadow.camera.near = 2
    spot.shadow.camera.far = 45
    spot.shadow.bias = -0.001
    scene.add(spot)
    // 聚光灯要有一个"看向哪里"的目标对象，而且它必须也在场景里
    spot.target.position.set(0, 0, 0)
    scene.add(spot.target)
    const spotHelper = new THREE.SpotLightHelper(spot, 0x88b4ff)

    // ---- 6. 面光：灯管形态的柔光，没有阴影 ----
    const rect = new THREE.RectAreaLight(0xff5a8a, 6, 8, 5)
    // 默认朝 +Z 方向发光，放在 -Z 一侧正好照向场地中心
    rect.position.set(0, 6, -11)
    scene.add(rect)
    // 面光本体不可见，用一块半透明平面把它画出来
    const rectVisual = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 5),
      new THREE.MeshBasicMaterial({ color: 0xff5a8a, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
    )
    rectVisual.position.copy(rect.position)
    world.add(rectVisual)

    // ---- 标签 ----
    const labels = [
      { text: 'AmbientLight', position: new THREE.Vector3(0, 1.2, 7.6) },
      { text: 'HemisphereLight', position: new THREE.Vector3(4.6, 6.4, 7.2) },
      { text: 'DirectionalLight', position: new THREE.Vector3(11, 14, 9) },
      { text: 'PointLight', position: new THREE.Vector3(0, 4.6, 0) },
      { text: 'SpotLight', position: new THREE.Vector3(-11, 12, -9) },
      { text: 'RectAreaLight', position: new THREE.Vector3(0, 6, -11) },
    ]
    for (const item of labels) {
      const label = createLabel(item.text, { size: 0.5 })
      label.position.copy(item.position)
      world.add(label)
    }

    // ---- 本章参数：每盏灯的开关与强度 ----
    const folder = world.folder('第 04 章')
    folder.add(ambient, 'intensity', 0, 3, 0.01).name('环境光强度')
    folder.add(hemisphere, 'intensity', 0, 3, 0.01).name('半球光强度')
    folder.add(key, 'intensity', 0, 6, 0.01).name('平行光强度')
    folder.add(point, 'intensity', 0, 150, 1).name('点光强度')
    folder.add(spot, 'intensity', 0, 500, 1).name('聚光强度')
    folder.add(rect, 'intensity', 0, 30, 0.1).name('面光强度')
    folder.add(spot, 'penumbra', 0, 1, 0.01).name('聚光边缘柔度')
    folder.add(spot, 'angle', 0.05, 1.2, 0.01).name('聚光锥角').onChange(() => spotHelper.update())

    // 换阴影贴图类型会让所有材质重新编译 —— 着色器里写死了 SHADOWMAP_TYPE_* 宏
    const SHADOW_TYPES = {
      基础: THREE.BasicShadowMap,
      PCF: THREE.PCFShadowMap,
      柔和PCF: THREE.PCFSoftShadowMap,
      VSM: THREE.VSMShadowMap,
    }
    const shadowParams = { 阴影类型: '柔和PCF' as keyof typeof SHADOW_TYPES }
    folder
      .add(shadowParams, '阴影类型', Object.keys(SHADOW_TYPES))
      .name('阴影贴图类型')
      .onChange((label: string) => {
        renderer.shadowMap.type = SHADOW_TYPES[label as keyof typeof SHADOW_TYPES]
        renderer.shadowMap.needsUpdate = true
        scene.traverse((child) => {
          const holder = child as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
          if (!holder.material) return
          for (const material of Array.isArray(holder.material) ? holder.material : [holder.material]) {
            material.needsUpdate = true
          }
        })
      })

    spotHelper.visible = false
    scene.add(spotHelper)
    folder.add(spotHelper, 'visible').name('显示聚光灯线框')
    folder.add(shadowCameraHelper, 'visible').name('显示阴影相机')
  },

  update(dt) {
    if (!orbitLight) return

    orbitAngle += dt * 0.45
    // 点光在球阵上方画圈，顺便让静态的球阵一直有变化的阴影
    orbitLight.position.set(
      Math.cos(orbitAngle) * 5.6,
      3.8 + Math.sin(orbitAngle * 1.7) * 0.9,
      Math.sin(orbitAngle) * 5.6,
    )
    // 灯光辅助器不会自动跟随，要手动 update
    orbitHelper?.update()
  },
}
