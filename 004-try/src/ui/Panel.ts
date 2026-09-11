import GUI from 'lil-gui'

/** 试验时间状态：暂停开关 + 时间倍率，main 每帧读它 */
export interface TimeState {
  paused: boolean
  scale: number
}

export interface PanelOptions {
  time: TimeState
  onPrev(): void
  onNext(): void
  onReset(): void
  onToggleWireframe(on: boolean): void
}

export interface PanelHandle {
  gui: GUI
  syncPaused(): boolean
  dispose(): void
}

/**
 * 全局面板。
 *
 * 只放"跟具体试验无关"的开关（时间、画面、导航），
 * 试验自己的参数由 World.folder() 挂到面板的「本试验」分组里 —— 切试验时自动销毁。
 */
export function createPanel(opts: PanelOptions): PanelHandle {
  const gui = new GUI({ title: 'TRY CONTROL', width: 252 })

  const controls = {
    paused: opts.time.paused,
    scale: opts.time.scale,
    wireframe: false,
    prev: () => opts.onPrev(),
    next: () => opts.onNext(),
    reset: () => opts.onReset(),
  }

  // ---------------- 试验 ----------------
  gui.add(controls, 'prev').name('← 上一个试验')
  gui.add(controls, 'next').name('下一个试验 →')
  gui.add(controls, 'reset').name('重置本试验 (R)')

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

  // ---------------- 画面 ----------------
  const view = gui.addFolder('画面')
  view.add(controls, 'wireframe').name('线框模式 (W)').onChange(opts.onToggleWireframe)
  view.close()

  return {
    gui,
    // 快捷键改过的东西，要让面板上的控件"对表"
    syncPaused: () => {
      controls.paused = opts.time.paused
      return controls.paused
    },
    dispose: () => gui.destroy(),
  }
}
