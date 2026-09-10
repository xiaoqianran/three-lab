import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import gradeFragment from '../shaders/grade.frag.glsl?raw'

export interface BloomParams {
  strength: number
  radius: number
  threshold: number
  aberration: number
  vignette: number
  grain: number
  lift: number
}

export const defaultBloomParams: BloomParams = {
  strength: 0.82,
  radius: 0.62,
  threshold: 0.16,
  aberration: 0.0075,
  vignette: 0.9,
  grain: 0.03,
  lift: 0.01,
}

export interface PostFXHandle {
  composer: EffectComposer
  bloom: UnrealBloomPass
  grade: ShaderPass
  params: BloomParams
  /** 分步演示的整体强度权重（0~1），sync 时会乘到各参数上 */
  stageBlend: { bloom: number; grade: number }
  sync(): void
  update(dt: number, elapsed: number): void
  dispose(): void
}

// ShaderPass 需要一个配套顶点着色器：就是把 uv 直接透传
const GRADE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  params: BloomParams = defaultBloomParams,
): PostFXHandle {
  const size = renderer.getSize(new THREE.Vector2())

  const composer = new EffectComposer(renderer)
  composer.setSize(size.x, size.y)

  composer.addPass(new RenderPass(scene, camera))

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    params.strength,
    params.radius,
    params.threshold,
  )
  composer.addPass(bloom)

  const grade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uAberration: { value: params.aberration },
      uVignette: { value: params.vignette },
      uGrain: { value: params.grain },
      uLift: { value: params.lift },
    },
    vertexShader: GRADE_VERTEX,
    fragmentShader: gradeFragment,
  })
  composer.addPass(grade)

  // OutputPass 负责 tone mapping 与 sRGB 输出，必须放在链尾
  composer.addPass(new OutputPass())

  // 分步演示期间逐帧驱动；权重为 0 时直接关掉对应 pass 省开销
  const stageBlend = { bloom: 1, grade: 1 }

  const sync = (): void => {
    bloom.strength = params.strength * stageBlend.bloom
    bloom.radius = params.radius
    bloom.threshold = params.threshold
    bloom.enabled = stageBlend.bloom > 0.01

    const u = grade.uniforms
    u.uAberration.value = params.aberration * stageBlend.grade
    u.uVignette.value = params.vignette * stageBlend.grade
    u.uGrain.value = params.grain * stageBlend.grade
    u.uLift.value = params.lift * stageBlend.grade
    grade.enabled = stageBlend.grade > 0.01
  }

  return {
    composer,
    bloom,
    grade,
    params,
    stageBlend,
    sync,
    update: (_dt, elapsed) => {
      grade.uniforms.uTime.value = elapsed
    },
    dispose: () => {
      composer.dispose()
    },
  }
}
