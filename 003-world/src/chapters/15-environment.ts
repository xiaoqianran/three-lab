import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 15 · 环境、雾与反射
 *
 * 前三章都在讲"物体表面"，这一章讲"物体所在的空气"：
 *
 *   Sky       用一份大气散射的着色器画出真实感的天空，太阳位置可调
 *   Fog       雾：让远处的物体逐渐融进背景色，是"体积感"和"距离感"最便宜的手段
 *              线性雾 Fog 从 near 到 far；指数雾 FogExp2 更接近真实空气
 *   PMREM     把一张环境图预先模糊成"辐照度贴图"，让 PBR 材质有环境反射。
 *              没有它，金属球在暗场景里就永远是黑的（因为没有东西可反射）
 *   Reflector 真正的镜面：每帧从镜像视角重画一遍场景，贴到平面上
 *
 * 一句话：**PBR 材质的金属感，靠的不是光照，是环境**。
 */

let sky: Sky | null = null
let sunLight: THREE.DirectionalLight | null = null
let envRenderTarget: THREE.WebGLRenderTarget | null = null
let pmrem: THREE.PMREMGenerator | null = null
let mirror: Reflector | null = null
const sunDirection = new THREE.Vector3()

const params = { 太阳高度: 30, 太阳方位: 145, 浑浊度: 6, 雾: '指数', 雾浓度: 0.004, 环境强度: 0.75, 显示镜面: true }

export const environment: Chapter = {
  id: '15-environment',
  title: '环境、雾与反射',
  summary:
    '先用 Sky 铺一片会随太阳高度变化的大气，再用 Fog / FogExp2 把地平线"推远"。中间那排金属球最能说明问题：环境贴图关掉它们就是黑的，打开立刻出现反射 —— PBR 的金属感全靠 scene.environment。最后放一面真镜面（Reflector）在角落里。',
  apis: [
    'Sky', 'sunPosition', 'Fog', 'FogExp2', 'scene.fog', 'PMREMGenerator', 'RoomEnvironment',
    'scene.environment', 'environmentIntensity', 'Reflector', 'metalness / roughness',
  ],
  files: ['src/chapters/15-environment.ts', 'src/core/Label.ts'],
  // 机位放在太阳的另一侧：这样太阳正好在画面里，天空的散射色最丰富
  camera: { radius: 34, theta: -0.62, phi: 1.02, target: [0, 2.5, 0] },

  build({ world, scene, renderer }) {
    // ---- 天空 ----
    sky = new Sky()
    // 天空盒是个包围整个场景的大盒子。它的着色器会把顶点深度固定到远平面，
    // 所以不会被相机远裁剪面切掉；但盒子太大时顶点插值精度会下降，几千单位足够用
    sky.scale.setScalar(4000)
    scene.add(sky)

    const skyUniforms = sky.material.uniforms
    skyUniforms.turbidity.value = params.浑浊度
    skyUniforms.rayleigh.value = 3
    skyUniforms.mieCoefficient.value = 0.005
    skyUniforms.mieDirectionalG.value = 0.8

    // 太阳（平行光）负责投影，天空里的太阳位置负责观感，两者要手动对齐
    sunLight = new THREE.DirectionalLight(0xfff0d8, 3)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.set(2048, 2048)
    sunLight.shadow.camera.left = -26
    sunLight.shadow.camera.right = 26
    sunLight.shadow.camera.top = 26
    sunLight.shadow.camera.bottom = -26
    sunLight.shadow.camera.far = 90
    sunLight.shadow.bias = -0.0009
    sunLight.shadow.camera.updateProjectionMatrix()
    scene.add(sunLight)
    scene.add(sunLight.target)

    // 天空本身就很亮，加上环境光和平行光，曝光必须压下来，否则整个画面一片死白
    renderer.toneMappingExposure = 0.55

    // 给背景一个天空色兜底：天空盒画上去之后会盖住它，
    // 但万一天空着色器在某些驱动（尤其是软件光栅）上出问题，也不会露出纯黑
    scene.background = new THREE.Color(0x9db8dc)

    // ---- 地面与金属球阵 ----
    const ground = world.ground(220, 0, 0x46536f)
    // 环境贴图会整体抬亮所有 PBR 材质；地面太亮会盖过天空，压一压它的环境贡献
    const groundMaterial = ground.material as THREE.MeshStandardMaterial
    groundMaterial.envMapIntensity = 0.5

    const sphereGeometry = new THREE.SphereGeometry(1, 48, 32)
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 6; column++) {
        const roughness = column / 5
        const metalness = row / 3
        const ball = new THREE.Mesh(
          sphereGeometry,
          new THREE.MeshStandardMaterial({
            // 金属的"颜色"其实是反射的颜色，所以 base color 给一个中性亮色
            color: 0xf2f4ff,
            roughness: Math.max(roughness, 0.03),
            metalness,
            envMapIntensity: 1,
          }),
        )
        ball.position.set((column - 2.5) * 2.6, 1.05, (row - 1.5) * 2.6 - 8)
        ball.castShadow = true
        ball.receiveShadow = true
        world.add(ball)
      }
    }

    const ballLabel = createLabel('横轴 roughness → 纵轴 metalness ↑', { size: 0.5 })
    ballLabel.position.set(0, 5.2, -8)
    world.add(ballLabel)

    // ---- 环境贴图（PMREM）----
    // PMREM 会把一张环境图预先模糊成"辐照度贴图"，PBR 材质才有东西可反射。
    // 真实项目里这里会加载一张 .hdr 全景图；为了不依赖素材文件，
    // 这一章用 three 自带的 RoomEnvironment —— 它就是一个"摄影棚"场景，
    // 里面几盏灯箱足够让金属球有像样的反射。
    pmrem = new THREE.PMREMGenerator(renderer)
    envRenderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = envRenderTarget.texture
    // 环境贴图除了当反射，还会作为整体的间接光照来源
    scene.environmentIntensity = params.环境强度

    // ---- 雾 ----
    applyFog(scene)

    // ---- 镜面 ----
    // 铺在金属球阵的前半段：球会在镜子里出现倒影，后半段仍然踩在普通地面上投阴影，
    // 两种效果正好放在一起对比
    mirror = new Reflector(new THREE.PlaneGeometry(17, 12), {
      // 镜像要单独渲染一遍场景，分辨率决定清晰度，也决定开销
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x9db2d8,
    })
    mirror.rotation.x = -Math.PI / 2
    mirror.position.set(0, 0.02, -3.2)
    world.add(mirror)

    const mirrorLabel = createLabel('Reflector · 逐帧镜像重绘', { size: 0.5 })
    mirrorLabel.position.set(-9.5, 3.4, -2)
    world.add(mirrorLabel)

    const sunLabel = createLabel('Sky · 大气散射', { size: 0.5 })
    sunLabel.position.set(0, 8.5, 4)
    world.add(sunLabel)

    // ---- 面板 ----
    const folder = world.folder('第 15 章')
    folder
      .add(params, '太阳高度', -2, 80, 0.5)
      .name('太阳高度角')
      .onChange(() => updateSun(sunLight!))
    folder
      .add(params, '太阳方位', 0, 360, 1)
      .name('太阳方位角')
      .onChange(() => updateSun(sunLight!))
    folder
      .add(params, '浑浊度', 1, 20, 0.1)
      .name('大气浑浊度 turbidity')
      .onChange((v: number) => {
        if (sky) sky.material.uniforms.turbidity.value = v
      })
    folder
      .add(params, '雾', ['无', '线性 Fog', '指数 FogExp2'])
      .name('雾的类型')
      .onChange(() => applyFog(scene))
    folder
      .add(params, '雾浓度', 0, 0.06, 0.001)
      .name('雾浓度 / 密度')
      .onChange(() => applyFog(scene))
    folder
      .add(params, '环境强度', 0, 3, 0.05)
      .name('environmentIntensity')
      .onChange((v: number) => {
        scene.environmentIntensity = v
      })
    folder
      .add(params, '显示镜面')
      .name('显示镜面')
      .onChange((v: boolean) => {
        if (mirror) mirror.visible = v
      })
    folder
      .add(
        {
          关掉环境贴图: () => {
            scene.environment = scene.environment ? null : (envRenderTarget?.texture ?? null)
          },
        },
        '关掉环境贴图',
      )
      .name('切换环境贴图（看金属球变黑）')

    updateSun(sunLight)
  },

  update() {
    // 天空、雾、镜面都是静态的，这里不需要逐帧更新
  },

  dispose({ scene, renderer }) {
    // 环境贴图与 PMREM 生成器是独立的 GPU 资源，必须自己释放
    scene.environment = null
    envRenderTarget?.dispose()
    pmrem?.dispose()
    envRenderTarget = null
    pmrem = null

    // 镜面内部有自己的渲染目标
    mirror?.dispose()
    mirror = null
    sky = null
    sunLight = null
    renderer.toneMappingExposure = 1.1
  },
}

/** 用高度角 / 方位角算出太阳方向，同时更新天空和光照 */
function updateSun(light: THREE.DirectionalLight): void {
  const phi = THREE.MathUtils.degToRad(90 - params.太阳高度)
  const theta = THREE.MathUtils.degToRad(params.太阳方位)
  sunDirection.setFromSphericalCoords(1, phi, theta)

  if (sky) sky.material.uniforms.sunPosition.value.copy(sunDirection)

  // 平行光的位置就是"太阳在哪个方向"，目标是原点，所以方向 = -position
  light.position.copy(sunDirection).multiplyScalar(60)
  light.target.position.set(0, 0, 0)

  // 太阳越低，光越暖越弱
  const elevation = THREE.MathUtils.clamp(params.太阳高度 / 60, 0, 1)
  light.intensity = 0.4 + elevation * 1.6
  light.color.setHSL(0.09, 0.55 - elevation * 0.4, 0.6 + elevation * 0.2)
}

/** 雾的颜色要和天空的地平线接近，否则远处会浮着一层灰 */
function applyFog(scene: THREE.Scene): void {
  const horizon = new THREE.Color(0xa8bcd8)
  if (params.雾 === '无') scene.fog = null
  else if (params.雾 === '线性 Fog') scene.fog = new THREE.Fog(horizon, 40, 260)
  else scene.fog = new THREE.FogExp2(horizon, params.雾浓度)
}
