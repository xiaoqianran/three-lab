import * as THREE from 'three'
import vertexShader from '../shaders/glow.vert.glsl?raw'
import fragmentShader from '../shaders/glow.frag.glsl?raw'

export interface CoreGlowHandle {
  readonly mesh: THREE.Mesh
  readonly uniforms: Record<string, THREE.IUniform>
  /** 每帧调用：billboard 朝向相机 */
  update(dt: number, elapsed: number, camera: THREE.Camera): void
  setColor(hex: string): void
  setIntensity(value: number): void
  dispose(): void
}

/**
 * 星系核心光晕。
 * 核心区域粒子本身已经最密，叠加一层过曝的加法光斑能让 bloom 抓住它，
 * 形成明亮炽热的核球。
 */
export function createCoreGlow(colorHex = '#ffe6c2', intensity = 1.1, size = 3.4): CoreGlowHandle {
  const uniforms: Record<string, THREE.IUniform> = {
    uColor: { value: new THREE.Color(colorHex) },
    uIntensity: { value: intensity },
    uFalloff: { value: 3.2 },
    uTime: { value: 0 },
  }

  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.setScalar(size)
  mesh.frustumCulled = false
  mesh.renderOrder = 1

  return {
    mesh,
    uniforms,
    update: (_dt, elapsed, camera) => {
      uniforms.uTime.value = elapsed
      mesh.quaternion.copy(camera.quaternion)
    },
    setColor: (hex) => {
      uniforms.uColor.value.set(hex)
    },
    setIntensity: (value) => {
      uniforms.uIntensity.value = value
    },
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}
