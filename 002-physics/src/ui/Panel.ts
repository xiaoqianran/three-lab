import GUI from 'lil-gui'
import type { PhysicsWorld } from '../core/PhysicsWorld'

export interface PanelOptions {
  physics: PhysicsWorld
  onReset: () => void
  onPrev: () => void
  onNext: () => void
  onToggleDebug: (on: boolean) => void
}

export interface PanelHandle {
  gui: GUI
  /** 让面板上的"暂停"开关跟上快捷键的变化 */
  syncPaused(): boolean
  dispose(): void
}

export function createPanel(opts: PanelOptions): PanelHandle {
  const gui = new GUI({ title: 'PHYSICS LAB', width: 252 })

  const controls = {
    paused: false,
    gravity: 1,
    debug: false,
    prev: () => opts.onPrev(),
    next: () => opts.onNext(),
    reset: () => opts.onReset(),
  }

  const sim = gui.addFolder('模拟')
  sim
    .add(controls, 'paused')
    .name('暂停物理 (Space)')
    .onChange((v: boolean) => {
      opts.physics.paused = v
    })
  sim
    .add(controls, 'gravity', 0, 3, 0.05)
    .name('重力倍率')
    .onChange((v: number) => opts.physics.setGravityScale(v))
  sim.close()

  const view = gui.addFolder('视图')
  view.add(controls, 'debug').name('碰撞体线框').onChange((v: boolean) => opts.onToggleDebug(v))
  view.close()

  gui.add(controls, 'prev').name('← 上一个展厅')
  gui.add(controls, 'next').name('下一个展厅 →')
  gui.add(controls, 'reset').name('重置展厅 (R)')

  return {
    gui,
    syncPaused: () => {
      controls.paused = opts.physics.paused
      return controls.paused
    },
    dispose: () => gui.destroy(),
  }
}
