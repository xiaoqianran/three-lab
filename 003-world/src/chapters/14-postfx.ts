import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 14 · 后处理链
 *
 * 后处理的思路是"不要直接画到屏幕，先画到一张贴图上，然后一路处理这张贴图"。
 * EffectComposer 就是这条流水线，addPass 往里接环节：
 *
 *   RenderPass   ① 把场景渲染进缓冲区（替代 renderer.render）
 *   UnrealBloomPass ② 泛光：亮部提取出来缩小、模糊、再叠回去
 *   ShaderPass   ③ 自定义后期（本章是暗角 + 色差 + 扫描线）
 *   FXAAShader   ④ 后期抗锯齿
 *   OutputPass   ⑤ 色调映射 + sRGB 输出
 *
 * 两个关键认知：
 *   · 链条中间的数据是**线性色**，所以中间环节不要自己做 sRGB 转换；
 *     最后一步交给 OutputPass，它同时也是 renderer.toneMapping 的执行者。
 *   · 每个 Pass 都是"一次全屏绘制"，加得越多越费。移动端要克制。
 */

/** 自定义后期着色器：vignette（暗角）+ chromatic aberration（色差）+ scanline（扫描线） */
const VignetteAberrationShader = {
  name: 'VignetteAberrationShader',
  uniforms: {
    // tDiffuse 是 EffectComposer 约定好的名字：上一环的输出贴图
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uStrength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      vec2 centered = vUv - 0.5;
      float distanceToCenter = length(centered);

      // 色差：R 和 B 两个通道朝相反方向错开一点点采样
      float offset = distanceToCenter * 0.008 * uStrength;
      float red = texture2D(tDiffuse, vUv + centered * offset).r;
      vec4 mid = texture2D(tDiffuse, vUv);
      float blue = texture2D(tDiffuse, vUv - centered * offset).b;

      vec3 color = vec3(red, mid.g, blue);

      // 暗角：越靠边越暗
      color *= mix(1.0, smoothstep(0.92, 0.22, distanceToCenter), uStrength);

      // 扫描线：细密的横纹
      color *= 1.0 - 0.045 * uStrength * (0.5 + 0.5 * sin(vUv.y * 1400.0 + uTime * 4.0));

      gl_FragColor = vec4(color, 1.0);
    }
  `,
}

let composer: EffectComposer | null = null
let bloomPass: UnrealBloomPass | null = null
let customPass: ShaderPass | null = null
let fxaaPass: ShaderPass | null = null
let pulseTime = 0
let glowSpheres: THREE.Mesh[] = []

const params = { 泛光: true, 泛光强度: 0.95, 泛光半径: 0.55, 泛光阈值: 0.6, 自定义后期: true, 后期强度: 1, FXAA: true, 启用后处理: true }

export const postfx: Chapter = {
  id: '14-postfx',
  title: '后处理链',
  summary:
    '一排自发光的球，经过「渲染 → 泛光 → 自定义后期（暗角+色差+扫描线）→ FXAA → 输出」五道工序。面板上每个环节都能单独开关，关掉对比一下，就知道每一道工序各自在干什么、代价有多大。',
  apis: [
    'EffectComposer', 'RenderPass', 'UnrealBloomPass', 'ShaderPass', 'OutputPass', 'FXAAShader',
    'tDiffuse 约定', 'composer.setSize', 'pass.enabled', '线性色与 OutputPass',
  ],
  files: ['src/chapters/14-postfx.ts', 'src/core/Label.ts'],
  camera: { radius: 26, theta: 0.4, phi: 1.02, target: [0, 2.2, 0] },

  build({ world, scene, renderer, camera, engine }) {
    world.ground(120, 0, 0x0b1020)
    world.grid(60, 60)
    scene.add(new THREE.AmbientLight(0x2b3550, 1.2))

    // ---- 布景：一排自发光的球 + 几圈灯管 ----
    // 泛光只对"足够亮"的像素起作用，所以发光物体要用 emissive / 不受光材质
    const palette = [0xff5a7a, 0xffb35a, 0xffe08a, 0x6bff9f, 0x5ac8ff, 0xa97aff, 0xff7ad9]

    glowSpheres = palette.map((color, index) => {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.72, 40, 28),
        new THREE.MeshStandardMaterial({
          color: 0x101828,
          roughness: 0.25,
          metalness: 0.4,
          // emissive 是"自发光"：它不参与光照计算，直接加到最终颜色上
          emissive: new THREE.Color(color),
          emissiveIntensity: 1.6,
        }),
      )
      sphere.position.set((index - 3) * 3.2, 1.8, -2)
      sphere.castShadow = true
      world.add(sphere)

      // 每个球外面套一光圈，泛光会更明显
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(1.2, 0.05, 12, 64),
        new THREE.MeshBasicMaterial({ color }),
      )
      halo.position.copy(sphere.position)
      halo.rotation.x = Math.PI / 2
      world.add(halo)

      return sphere
    })

    const groundLight = new THREE.PointLight(0x88aaff, 260, 40, 2)
    groundLight.position.set(0, 4, 6)
    scene.add(groundLight)

    const label = createLabel('OutputPass 之前的颜色都是线性色', { size: 0.6 })
    label.position.set(0, 5.6, -2)
    world.add(label)

    // ---- 组装后期链 ----
    composer = new EffectComposer(renderer)
    // composer 有自己的渲染目标，像素比要跟渲染器对齐
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(window.innerWidth, window.innerHeight)

    // ① 场景 → 缓冲区
    composer.addPass(new RenderPass(scene, camera.camera))

    // ② 泛光：strength 强度 / radius 扩散半径 / threshold 亮度门槛
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      params.泛光强度,
      params.泛光半径,
      params.泛光阈值,
    )
    // 与颜色空间一样：阈值是在线性色里比较的，所以 0.6 已经算很亮了
    composer.addPass(bloomPass)

    // ③ 自定义后期
    customPass = new ShaderPass(VignetteAberrationShader)
    composer.addPass(customPass)

    // ④ FXAA：后期抗锯齿，靠像素邻域找边缘，成本比 MSAA 低
    fxaaPass = new ShaderPass(FXAAShader)
    composer.addPass(fxaaPass)
    updateFxaaResolution(renderer.getPixelRatio())

    // ⑤ 输出：色调映射 + sRGB。它是整条链的收尾，必须放最后
    composer.addPass(new OutputPass())

    // 交给引擎：之后主循环会走 composer.render() 而不是 renderer.render()
    engine.composer = composer

    world.onResize(() => {
      // 尺寸变化时 composer 由 Engine 统一 setSize，这里只需要更新 FXAA 的分辨率
      updateFxaaResolution(engine.currentPixelRatio)
    })

    // ---- 面板 ----
    const folder = world.folder('第 14 章')
    folder
      .add(params, '启用后处理')
      .name('启用后处理链')
      .onChange((v: boolean) => {
        // 直接对比"有后期 / 无后期"，最能说明它在做什么
        engine.composer = v ? composer : null
      })
    folder
      .add(params, '泛光')
      .name('② 泛光')
      .onChange((v: boolean) => {
        if (bloomPass) bloomPass.enabled = v
      })
    folder
      .add(params, '泛光强度', 0, 3, 0.01)
      .name('　泛光强度')
      .onChange((v: number) => {
        if (bloomPass) bloomPass.strength = v
      })
    folder
      .add(params, '泛光半径', 0, 1.5, 0.01)
      .name('　泛光半径')
      .onChange((v: number) => {
        if (bloomPass) bloomPass.radius = v
      })
    folder
      .add(params, '泛光阈值', 0, 1, 0.01)
      .name('　泛光阈值')
      .onChange((v: number) => {
        if (bloomPass) bloomPass.threshold = v
      })
    folder
      .add(params, '自定义后期')
      .name('③ 暗角 / 色差 / 扫描线')
      .onChange((v: boolean) => {
        if (customPass) customPass.enabled = v
      })
    folder
      .add(params, '后期强度', 0, 2, 0.02)
      .name('　后期强度 uStrength')
      .onChange((v: number) => {
        if (customPass) customPass.uniforms.uStrength.value = v
      })
    folder
      .add(params, 'FXAA')
      .name('④ FXAA 抗锯齿')
      .onChange((v: boolean) => {
        if (fxaaPass) fxaaPass.enabled = v
      })
  },

  update(dt) {
    pulseTime += dt

    // 让自发光强度轻微呼吸，泛光的"活感"就来自这里
    const pulse = 1.2 + Math.sin(pulseTime * 1.6) * 0.45
    for (let i = 0; i < glowSpheres.length; i++) {
      const material = glowSpheres[i].material as THREE.MeshStandardMaterial
      material.emissiveIntensity = pulse * (1 + Math.sin(i) * 0.3)
    }

    if (customPass) customPass.uniforms.uTime.value = pulseTime
  },

  dispose({ engine }) {
    engine.composer = null
    // EffectComposer.dispose() 会把内部的渲染目标一并释放
    composer?.dispose()
    composer = null
    bloomPass = null
    customPass = null
    fxaaPass = null
    glowSpheres = []
    pulseTime = 0
  },
}

/** FXAA 是按"像素"工作的，得告诉它一个像素在 uv 里有多宽多高 */
function updateFxaaResolution(pixelRatio: number): void {
  if (!fxaaPass) return
  const width = window.innerWidth * pixelRatio
  const height = window.innerHeight * pixelRatio
  const resolution = fxaaPass.material.uniforms.resolution
  if (resolution) resolution.value.set(1 / width, 1 / height)
}
