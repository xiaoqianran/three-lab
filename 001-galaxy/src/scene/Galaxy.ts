import * as THREE from 'three'
import vertexShader from '../shaders/galaxy.vert.glsl?raw'
import fragmentShader from '../shaders/galaxy.frag.glsl?raw'
import dustFragmentShader from '../shaders/dust.frag.glsl?raw'

export interface GalaxyParams {
  /** 粒子数量 */
  count: number
  /** 盘面半径 */
  radius: number
  /** 旋臂数量 */
  arms: number
  /** 0~1，粒子聚束到旋臂上的比例（越小越发散越像星云） */
  armStrength: number
  /** 螺旋缠绕紧密度 */
  armTightness: number
  /** 自转基准角速度 */
  spin: number
  /** 差速剪切强度（0 = 刚体自转，旋臂永不缠绕） */
  shear: number
  /** 盘面厚度 */
  thickness: number
  /** 流场噪声频率 */
  noiseFreq: number
  /** 流场扰动幅度 */
  noiseAmp: number
  /** 流场演化速度 */
  noiseSpeed: number
  /** 粒子基础尺寸 */
  size: number
  /** 全局亮度 */
  brightness: number
  colorCore: string
  colorMid: string
  colorEdge: string
  /** 年龄分层强度倍率 */
  ageStrength: number
  /** 衍射星芒强度倍率 */
  spikeStrength: number
  /** 尘埃带浓度倍率 */
  dustStrength: number
  /** 景深强度倍率 */
  dofStrength: number
  /** 时间倍率：1 = 正常，负值 = 倒放（仅自由探索模式生效） */
  timeScale: number
}

export const defaultParams: GalaxyParams = {
  count: 260_000,
  radius: 12,
  arms: 2,
  armStrength: 0.86,
  armTightness: 2.1,
  spin: 0.15,
  shear: 0.55,
  thickness: 0.62,
  noiseFreq: 0.42,
  noiseAmp: 0.42,
  noiseSpeed: 0.12,
  size: 0.075,
  brightness: 1.35,
  colorCore: '#fff1d8',
  colorMid: '#7fb4ff',
  colorEdge: '#ff6a3d',
  ageStrength: 1,
  spikeStrength: 1,
  dustStrength: 1,
  dofStrength: 1,
  timeScale: 1,
}

export interface GalaxyHandle {
  /** 恒星层 */
  readonly points: THREE.Points
  /** 尘埃层：与恒星层共用几何体，但走减法混合 */
  readonly dust: THREE.Points
  /** 伴星系：同样共用几何体，靠 uBodyOffset 平移到另一侧 */
  readonly companion: THREE.Points
  readonly uniforms: Record<string, THREE.IUniform>
  readonly dustUniforms: Record<string, THREE.IUniform>
  readonly companionUniforms: Record<string, THREE.IUniform>
  rebuild(count: number): void
  syncUniforms(): void
  dispose(): void
}

/** 演示模式下需要逐帧驱动的权重 uniform 名称（恒星与尘埃共用同一套名字） */
export const DEMO_UNIFORMS = [
  'uOpacity',
  'uArmBlend',
  'uThicknessBlend',
  'uNoiseBlend',
  'uColorBlend',
  'uSoftBlend',
  'uAgeBlend',
  'uSpike',
] as const

/**
 * 显存槽位上限。
 * BufferAttribute.count 是构造时算好的普通属性，替换 .array 不会同步它，
 * 所以这里一次性按上限分配，之后只重填前 count 个并靠 drawRange 裁切。
 */
const MAX_COUNT = 1_200_000

/** 与 galaxy.vert.glsl 里的 #define FLASH_COUNT 保持一致 */
export const FLASH_COUNT = 6

/** 用近似高斯分布替代 Math.random()，让散布更自然 */
function gaussianish(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 0.8165
}

interface AttributeBuffers {
  position: Float32Array
  aSize: Float32Array
  aSeed: Float32Array
  aRandomAngle: Float32Array
  aAge: Float32Array
}

function fillAttributes(buf: AttributeBuffers, count: number, p: GalaxyParams): void {
  const { position, aSize, aSeed, aRandomAngle, aAge } = buf
  const arms = Math.max(1, Math.round(p.arms))
  const r = p.radius

  for (let i = 0; i < count; i++) {
    // 表面密度近似指数盘：中心密集，外缘稀疏
    const rn = Math.pow(Math.random(), 0.62)
    const dist = 0.16 + rn * r

    // 对数螺旋：采样相位时先加上进动角，保证聚束落在旋臂上
    const tilt = p.armTightness * Math.log(1 + rn * 3.2)

    let ang: number
    let age: number

    if (rn < 0.2 || Math.random() > p.armStrength) {
      // 核球与弥散晕：很久以前形成的恒星，黄红色
      ang = Math.random() * Math.PI * 2
      age = Math.random() * 0.3
    } else {
      // 旋臂：恒星形成区，年轻的蓝白色恒星
      const arm = Math.floor(Math.random() * arms)
      ang = tilt + (arm / arms) * Math.PI * 2 + gaussianish() * 0.22
      age = 0.55 + Math.random() * 0.45
    }

    const i3 = i * 3
    position[i3] = Math.cos(ang) * dist
    position[i3 + 1] = gaussianish() * p.thickness * (1.25 - rn * 0.8)
    position[i3 + 2] = Math.sin(ang) * dist

    // 少量"亮星"点得更粗
    aSize[i] = 0.45 + Math.pow(Math.random(), 4) * 3.2
    aSeed[i] = Math.random()
    aAge[i] = age

    // 与旋臂无关的均匀相位：演示第 2 步的"随机云"靠它，
    // 半径/高度与 position 完全一致，只有角度不同。
    aRandomAngle[i] = Math.random() * Math.PI * 2
  }
}

function createUniformSet(
  params: GalaxyParams,
  pixelRatio: number,
): Record<string, THREE.IUniform> {
  return {
    uAnimTime: { value: 0 },
    uSpinPhase: { value: 0 },
    uRadius: { value: params.radius },
    uSpin: { value: params.spin },
    uShear: { value: params.shear },
    uNoiseFreq: { value: params.noiseFreq },
    uNoiseAmp: { value: params.noiseAmp },
    uNoiseSpeed: { value: params.noiseSpeed },
    uSize: { value: params.size },
    uPixelRatio: { value: pixelRatio },
    uBrightness: { value: params.brightness },
    uColorCore: { value: new THREE.Color(params.colorCore) },
    uColorMid: { value: new THREE.Color(params.colorMid) },
    uColorEdge: { value: new THREE.Color(params.colorEdge) },

    // 演示权重默认全开，这样不走演示流程时就是最终成品
    uOpacity: { value: 1 },
    uArmBlend: { value: 1 },
    uThicknessBlend: { value: 1 },
    uNoiseBlend: { value: 1 },
    uColorBlend: { value: 1 },
    uSoftBlend: { value: 1 },
    uAgeBlend: { value: 1 },
    uSpike: { value: 1 },

    // 尘埃层用这两项把自己错开到旋臂内侧，并压得更薄
    uPhaseOffset: { value: 0 },
    uThicknessScale: { value: 1 },

    // 鼠标引力扰动
    uPointerPos: { value: new THREE.Vector3() },
    uPointerStrength: { value: 0 },
    uPointerRadius: { value: 6 },

    // 超新星闪光池：age > 1 表示该槽位空闲
    uFlashPos: {
      value: Array.from({ length: FLASH_COUNT }, () => new THREE.Vector3()),
    },
    uFlashAge: { value: new Float32Array(FLASH_COUNT).fill(2) },
    uFlashStrength: { value: 0 },

    // 形态演化：0 = 球状气体云，1 = 已成盘
    uCollapseBlend: { value: 1 },

    // 景深散景近似
    uFocusDistance: { value: 18 },
    uDofStrength: { value: 0 },

    // 星系碰撞
    uBodyOffset: { value: new THREE.Vector3() },
    // 默认放到极远处，等于不生效
    uOtherCenter: { value: new THREE.Vector3(9e4, 9e4, 9e4) },
    uTidalStrength: { value: 0 },
    uParticleKeep: { value: 1 },
  }
}

export function createGalaxy(params: GalaxyParams, pixelRatio: number): GalaxyHandle {
  const uniforms = createUniformSet(params, pixelRatio)
  const dustUniforms = createUniformSet(params, pixelRatio)
  const companionUniforms = createUniformSet(params, pixelRatio)

  // ---- 尘埃层的差异化配置 ----
  dustUniforms.uPhaseOffset.value = -0.44 // 相对恒星旋臂转一个角度，落在内侧
  dustUniforms.uThicknessScale.value = 0.45 // 尘埃盘比恒星盘更薄
  dustUniforms.uSize.value = params.size * 3.4 // 尘埃是弥漫的，点更大
  dustUniforms.uBrightness.value = 1
  dustUniforms.uSpike.value = 0
  dustUniforms.uAgeBlend.value = 0
  dustUniforms.uSoftBlend.value = 1
  // 第 15 步之前完全不可见
  dustUniforms.uOpacity.value = 0

  // ---- 伴星系的差异化配置 ----
  // 只取约三分之一的粒子，省掉一大半开销
  companionUniforms.uParticleKeep.value = 0.32
  companionUniforms.uSpike.value = 0
  companionUniforms.uOpacity.value = 0

  const geometry = new THREE.BufferGeometry()

  // 一次性按上限分配，后续切换粒子数只重填前 count 个
  const buffers: AttributeBuffers = {
    position: new Float32Array(MAX_COUNT * 3),
    aSize: new Float32Array(MAX_COUNT),
    aSeed: new Float32Array(MAX_COUNT),
    aRandomAngle: new Float32Array(MAX_COUNT),
    aAge: new Float32Array(MAX_COUNT),
  }

  const posAttr = new THREE.BufferAttribute(buffers.position, 3)
  const sizeAttr = new THREE.BufferAttribute(buffers.aSize, 1)
  const seedAttr = new THREE.BufferAttribute(buffers.aSeed, 1)
  const angleAttr = new THREE.BufferAttribute(buffers.aRandomAngle, 1)
  const ageAttr = new THREE.BufferAttribute(buffers.aAge, 1)

  for (const attr of [posAttr, sizeAttr, seedAttr, angleAttr, ageAttr]) {
    attr.setUsage(THREE.DynamicDrawUsage)
  }

  geometry.setAttribute('position', posAttr)
  geometry.setAttribute('aSize', sizeAttr)
  geometry.setAttribute('aSeed', seedAttr)
  geometry.setAttribute('aRandomAngle', angleAttr)
  geometry.setAttribute('aAge', ageAttr)

  const starMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })

  // 减法混合：dst = src * 0 + dst * (1 - srcAlpha)
  const dustMaterial = new THREE.ShaderMaterial({
    uniforms: dustUniforms,
    vertexShader,
    fragmentShader: dustFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })

  const companionMaterial = new THREE.ShaderMaterial({
    uniforms: companionUniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, starMaterial)
  const dust = new THREE.Points(geometry, dustMaterial)
  const companion = new THREE.Points(geometry, companionMaterial)

  // 顶点在着色器里被位移，包围球不可信，直接关闭剔除
  points.frustumCulled = false
  dust.frustumCulled = false
  companion.frustumCulled = false

  points.renderOrder = 1
  companion.renderOrder = 1
  dust.renderOrder = 2 // 必须压在星光之上，才吃得到背后的光

  const syncUniforms = (): void => {
    for (const set of [uniforms, dustUniforms, companionUniforms]) {
      set.uRadius.value = params.radius
      set.uSpin.value = params.spin
      set.uShear.value = params.shear
      set.uNoiseFreq.value = params.noiseFreq
      set.uNoiseAmp.value = params.noiseAmp
      set.uNoiseSpeed.value = params.noiseSpeed
      set.uBrightness.value = params.brightness
      set.uColorCore.value.set(params.colorCore)
      set.uColorMid.value.set(params.colorMid)
      set.uColorEdge.value.set(params.colorEdge)
    }

    // 尺寸基准不同，需要分别赋值
    uniforms.uSize.value = params.size
    dustUniforms.uSize.value = params.size * 3.4
    companionUniforms.uSize.value = params.size
  }

  const rebuild = (count: number): void => {
    const safe = Math.min(count, MAX_COUNT)

    fillAttributes(buffers, safe, params)

    posAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    seedAttr.needsUpdate = true
    angleAttr.needsUpdate = true
    ageAttr.needsUpdate = true

    geometry.setDrawRange(0, safe)
  }

  // 首次填充
  rebuild(params.count)

  const dispose = (): void => {
    geometry.dispose()
    starMaterial.dispose()
    dustMaterial.dispose()
    companionMaterial.dispose()
  }

  return {
    points,
    dust,
    companion,
    uniforms,
    dustUniforms,
    companionUniforms,
    rebuild,
    syncUniforms,
    dispose,
  }
}
