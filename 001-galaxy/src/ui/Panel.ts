import GUI from 'lil-gui'
import type { GalaxyHandle, GalaxyParams } from '../scene/Galaxy'
import type { BloomParams, PostFXHandle } from '../scene/PostFX'
import type { CameraRig } from '../core/CameraRig'
import type { CoreGlowHandle } from '../scene/CoreGlow'

/** 画质相关的运行时状态，由 main 每帧读取 */
export interface QualityState {
  adaptive: boolean
}

export const PRESET_NAMES = ['M51 · 双旋臂', '银河系 · 棒旋四臂', '仙女座 · 环状', '星暴 · 湍流'] as const

export interface PanelOptions {
  params: GalaxyParams
  bloomParams: BloomParams
  quality: QualityState
  galaxy: GalaxyHandle
  post: PostFXHandle
  rig: CameraRig
  core: CoreGlowHandle
  onCountChange: (count: number) => void
  onReset: () => void
  onPreset: (index: number) => void
  onScreenshot: () => void
  onToggleRecording: () => void
  isRecording: () => boolean
}

export interface PanelHandle {
  gui: GUI
  toggle(): void
  /** 分步演示期间控制面板的淡入淡出（0 = 完全隐藏且不可点击） */
  setOpacity(value: number): void
  dispose(): void
}

export function createPanel(opts: PanelOptions): PanelHandle {
  const { params, bloomParams, quality, galaxy, post, rig, core } = opts

  const gui = new GUI({ title: 'GALAXY CONTROL', width: 272 })

  // ---------------- 形态 ----------------
  const shape = gui.addFolder('形态')
  shape
    .add(params, 'count', 30_000, 1_200_000, 10_000)
    .name('粒子数量')
    .onFinishChange((v: number) => {
      galaxy.rebuild(v)
      opts.onCountChange(v)
    })
  shape.add(params, 'radius', 4, 30, 0.1).name('盘面半径').onChange(() => galaxy.syncUniforms())

  // 下面这几项会重新生成粒子分布，只在松手时重建，避免拖动过程中反复重填
  shape
    .add(params, 'arms', 1, 6, 1)
    .name('旋臂数量')
    .onFinishChange(() => galaxy.rebuild(params.count))
  shape
    .add(params, 'armStrength', 0, 1, 0.01)
    .name('旋臂聚束')
    .onFinishChange(() => galaxy.rebuild(params.count))
  shape
    .add(params, 'armTightness', 0, 5, 0.05)
    .name('缠绕紧密度')
    .onFinishChange(() => galaxy.rebuild(params.count))
  shape
    .add(params, 'thickness', 0.05, 3, 0.01)
    .name('盘面厚度')
    .onFinishChange(() => galaxy.rebuild(params.count))
  shape.close()

  // ---------------- 运动 ----------------
  const motion = gui.addFolder('运动')
  motion.add(params, 'spin', 0, 0.4, 0.001).name('自转速度').onChange(() => galaxy.syncUniforms())
  motion.add(params, 'shear', 0, 2, 0.01).name('差速剪切').onChange(() => galaxy.syncUniforms())
  motion.add(params, 'timeScale', -3, 3, 0.05).name('时间倍率')
  motion.add(params, 'noiseFreq', 0.02, 2, 0.01).name('流场频率').onChange(() => galaxy.syncUniforms())
  motion.add(params, 'noiseAmp', 0, 2, 0.01).name('流场扰动').onChange(() => galaxy.syncUniforms())
  motion.add(params, 'noiseSpeed', 0, 1, 0.005).name('流场速度').onChange(() => galaxy.syncUniforms())

  // ---------------- 外观 ----------------
  const look = gui.addFolder('外观')
  look.add(params, 'size', 0.01, 0.4, 0.005).name('粒子尺寸').onChange(() => galaxy.syncUniforms())
  look.add(params, 'brightness', 0, 3, 0.01).name('亮度').onChange(() => galaxy.syncUniforms())
  look.addColor(params, 'colorCore').name('核心色').onChange(() => galaxy.syncUniforms())
  look.addColor(params, 'colorMid').name('旋臂色').onChange(() => galaxy.syncUniforms())
  look.addColor(params, 'colorEdge').name('外缘色').onChange(() => galaxy.syncUniforms())
  look.add(params, 'ageStrength', 0, 1.5, 0.01).name('年龄分层')
  look.add(params, 'spikeStrength', 0, 2, 0.01).name('星芒强度')
  look.add(params, 'dustStrength', 0, 1.5, 0.01).name('尘埃浓度')
  look.add(params, 'dofStrength', 0, 2, 0.01).name('景深强度')
  look.close()

  // ---------------- 后处理 ----------------
  const postFx = gui.addFolder('后处理')
  postFx.add(bloomParams, 'strength', 0, 3, 0.01).name('泛光强度').onChange(() => post.sync())
  postFx.add(bloomParams, 'radius', 0, 1.5, 0.01).name('泛光半径').onChange(() => post.sync())
  postFx.add(bloomParams, 'threshold', 0, 1, 0.01).name('泛光阈值').onChange(() => post.sync())
  postFx.add(bloomParams, 'aberration', 0, 0.03, 0.0005).name('色差').onChange(() => post.sync())
  postFx.add(bloomParams, 'vignette', 0, 1, 0.01).name('暗角').onChange(() => post.sync())
  postFx.add(bloomParams, 'grain', 0, 0.15, 0.001).name('颗粒').onChange(() => post.sync())
  postFx.add(bloomParams, 'lift', 0, 0.08, 0.001).name('暗部提亮').onChange(() => post.sync())
  postFx.close()

  // ---------------- 相机 ----------------
  const cam = gui.addFolder('相机')
  cam.add(rig, 'autopilot').name('自动巡游 (Space)')
  cam.add(rig, 'autopilotSpeed', 0.005, 0.3, 0.005).name('巡游速度')
  cam
    .add({ intensity: core.uniforms.uIntensity.value }, 'intensity', 0, 4, 0.01)
    .name('核心光晕')
    .onChange((v: number) => core.setIntensity(v))
  cam.add({ reset: opts.onReset }, 'reset').name('复位视角 (R)')
  cam.close()

  // ---------------- 输出与预设 ----------------
  const output = gui.addFolder('输出与预设')

  const presetState = { 形态预设: PRESET_NAMES[0] as string }
  output
    .add(presetState, '形态预设', PRESET_NAMES as unknown as string[])
    .name('形态预设')
    .onChange((name: string) => {
      opts.onPreset(PRESET_NAMES.indexOf(name as (typeof PRESET_NAMES)[number]))
    })

  const actions = {
    screenshot: () => opts.onScreenshot(),
    record: () => {
      opts.onToggleRecording()
      recordCtrl?.name(opts.isRecording() ? '■ 停止录屏' : '● 开始录屏')
    },
  }

  output.add(actions, 'screenshot').name('保存截图 (PNG)')
  let recordCtrl: { name(v: string): unknown } | null = null
  recordCtrl = output.add(actions, 'record').name('● 开始录屏')

  output.add(quality, 'adaptive').name('自适应画质')
  output.close()

  const setOpacity = (value: number): void => {
    const el = gui.domElement
    el.style.opacity = value.toFixed(3)
    el.style.visibility = value < 0.01 ? 'hidden' : 'visible'
    el.style.pointerEvents = value > 0.85 ? '' : 'none'
  }

  setOpacity(1)

  return {
    gui,
    toggle: () => {
      const el = gui.domElement
      el.style.display = el.style.display === 'none' ? '' : 'none'
    },
    setOpacity,
    dispose: () => gui.destroy(),
  }
}
