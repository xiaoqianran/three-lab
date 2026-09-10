import * as THREE from 'three'
import vertexShader from '../shaders/satellite.vert.glsl?raw'
import fragmentShader from '../shaders/satellite.frag.glsl?raw'

export interface SatelliteParams {
  count: number
  /** 轨道半长轴 */
  orbitRadius: number
  /** 离心率：越大越扁，近星点掠过时尾巴会被拉得更长 */
  ecc: number
  /** 轨道面相对盘面的倾角 */
  tilt: number
  size: number
  colorCore: string
  colorTail: string
  /** 轨道角速度（弧度/秒） */
  angularSpeed: number
}

export const defaultSatelliteParams: SatelliteParams = {
  count: 36_000,
  orbitRadius: 21,
  ecc: 0.42,
  tilt: 0.38,
  size: 0.062,
  colorCore: '#d6e4ff',
  colorTail: '#8f6fd8',
  angularSpeed: 0.16,
}

export interface SatelliteHandle {
  readonly points: THREE.Points
  readonly uniforms: Record<string, THREE.IUniform>
  /** dt 已经乘过演示权重，权重为 0 时卫星停住 */
  update(dt: number): void
  syncUniforms(): void
  dispose(): void
}

function gaussianish(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 0.8165
}

export function createSatellite(params: SatelliteParams, pixelRatio: number): SatelliteHandle {
  const uniforms: Record<string, THREE.IUniform> = {
    uSatPhase: { value: 0 },
    uSatOrbitRadius: { value: params.orbitRadius },
    uSatEcc: { value: params.ecc },
    uSatTilt: { value: params.tilt },
    uSatOpacity: { value: 1 },
    uSatSize: { value: params.size },
    uPixelRatio: { value: pixelRatio },
    uTime: { value: 0 },
    uColorCore: { value: new THREE.Color(params.colorCore) },
    uColorTail: { value: new THREE.Color(params.colorTail) },
  }

  const { count } = params
  const tail = new Float32Array(count * 3)
  const aSize = new Float32Array(count)
  const aSeed = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const i3 = i * 3

    if (Math.random() < 0.58) {
      // 本体：球状核心
      const rr = Math.pow(Math.random(), 0.55)
      const u = Math.random() * 2 - 1
      const ph = Math.random() * Math.PI * 2
      const s = Math.sqrt(Math.max(0, 1 - u * u))

      tail[i3] = s * Math.cos(ph) * rr
      tail[i3 + 1] = s * Math.sin(ph) * rr
      tail[i3 + 2] = u * rr * 0.75
    } else {
      // 尾巴：沿切线向后拖出，越远越窄
      const t = -0.4 - Math.pow(Math.random(), 0.62) * 7.6
      const spread = 0.6 * Math.exp(t * 0.17)

      tail[i3] = t
      tail[i3 + 1] = gaussianish() * spread
      tail[i3 + 2] = gaussianish() * spread * 0.7
    }

    aSize[i] = 0.5 + Math.pow(Math.random(), 3) * 2.4
    aSeed[i] = Math.random()
  }

  const geometry = new THREE.BufferGeometry()
  // position 只是占位：真实坐标完全由着色器算出来
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('aTail', new THREE.BufferAttribute(tail, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1))

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 1

  const syncUniforms = (): void => {
    uniforms.uSatOrbitRadius.value = params.orbitRadius
    uniforms.uSatEcc.value = params.ecc
    uniforms.uSatTilt.value = params.tilt
    uniforms.uSatSize.value = params.size
    uniforms.uColorCore.value.set(params.colorCore)
    uniforms.uColorTail.value.set(params.colorTail)
  }

  return {
    points,
    uniforms,
    update: (dt) => {
      uniforms.uSatPhase.value += dt * params.angularSpeed
    },
    syncUniforms,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}
