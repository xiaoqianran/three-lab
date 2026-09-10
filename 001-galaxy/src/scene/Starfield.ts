import * as THREE from 'three'

export interface StarfieldHandle {
  readonly points: THREE.Points
  /** 分步演示用的淡入淡出 */
  setOpacity(value: number): void
  dispose(): void
}

/**
 * 远景背景星：均匀球壳分布，按色温随机着色。
 * 纯装饰，不参与任何模拟。
 */
export function createStarfield(count = 9000, shellRadius = 1200): StarfieldHandle {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const color = new THREE.Color()

  for (let i = 0; i < count; i++) {
    // 球面均匀采样
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    const r = shellRadius * (0.65 + Math.random() * 0.35)

    const i3 = i * 3
    positions[i3] = Math.cos(theta) * s * r
    positions[i3 + 1] = u * r
    positions[i3 + 2] = Math.sin(theta) * s * r

    // 蓝白 -> 暖黄的色温分布
    const hue = 0.56 + Math.random() * 0.12
    const sat = 0.15 + Math.random() * 0.45
    const lig = 0.45 + Math.random() * 0.5
    color.setHSL(hue, sat, lig)

    colors[i3] = color.r
    colors[i3 + 1] = color.g
    colors[i3 + 2] = color.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false

  const baseOpacity = 0.85

  return {
    points,
    setOpacity: (value) => {
      material.opacity = baseOpacity * value
      points.visible = value > 0.01
    },
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}
