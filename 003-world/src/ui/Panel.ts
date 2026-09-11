import GUI from 'lil-gui'
import type { CameraRig } from '../core/CameraRig'

/** 章节时间状态：暂停开关 + 时间倍率，main 每帧读它 */
export interface TimeState {
  paused: boolean
  scale: number
}

export interface PanelOptions {
  camera: CameraRig
  time: TimeState
  onPrev(): void
  onNext(): void
  onReset(): void
  onToggleWireframe(on: boolean): void
  onToggleSource(on: boolean): void
}

export interface PanelHandle {
  gui: GUI
  /** 快捷键改了自动旋转之后，让面板上的开关跟上 */
  syncAutoRotate(): boolean
  syncPaused(): boolean
  dispose(): void
}

/**
 * 全局控制面板。
 *
 * 这里只放"跟具体章节无关"的东西（时间、相机、画面），
 * 章节自己的参数由 World.folder() 挂到面板的「本章」分组里。
 */
export function createPanel(opts: PanelOptions): PanelHandle {
  const gui = new GUI({ title: 'WORLD CONTROL', width: 252 })

  const controls = {
    paused: opts.time.paused,
    scale: opts.time.scale,
    autoRotate: opts.camera.autoRotate,
    wireframe: false,
    source: false,
    prev: () => opts.onPrev(),
    next: () => opts.onNext(),
    reset: () => opts.onReset(),
  }

  // ---------------- 章节 ----------------
  gui.add(controls, 'prev').name('← 上一章')
  gui.add(controls, 'next').name('下一章 →')
  gui.add(controls, 'reset').name('重置本章 (R)')

  // ---------------- 时间 ----------------
  const time = gui.addFolder('时间')
  time
    .add(controls, 'paused')
    .name('暂停 (Space)')
    .onChange((v: boolean) => {
      opts.time.paused = v
    })
  time
    .add(controls, 'scale', 0, 3, 0.05)
    .name('时间倍率')
    .onChange((v: number) => {
      opts.time.scale = v
    })
  time.close()

  // ---------------- 相机 ----------------
  const camera = gui.addFolder('相机')
  camera
    .add(controls, 'autoRotate')
    .name('自动旋转 (A)')
    .onChange((v: boolean) => {
      opts.camera.autoRotate = v
    })
  camera.add(opts.camera, 'autoRotateSpeed', 0, 0.6, 0.01).name('旋转速度')
  camera.close()

  // ---------------- 画面 ----------------
  const view = gui.addFolder('画面')
  view.add(controls, 'wireframe').name('线框模式 (W)').onChange(opts.onToggleWireframe)
  view
    .add(controls, 'source')
    .name('源码面板 (C)')
    .onChange((v: boolean) => opts.onToggleSource(v))
  view.close()

  return {
    gui,
    // lil-gui 的控件不会自己感知外部改动，快捷键改完要回来"对表"
    syncAutoRotate: () => {
      controls.autoRotate = opts.camera.autoRotate
      return controls.autoRotate
    },
    syncPaused: () => {
      controls.paused = opts.time.paused
      return controls.paused
    },
    dispose: () => gui.destroy(),
  }
}
