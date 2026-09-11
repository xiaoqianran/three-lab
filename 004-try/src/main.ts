import './style.css'
import type * as THREE from 'three'
import { Engine } from './core/Engine'
import { Orbit } from './core/Orbit'
import { World } from './core/World'
import { TRIES } from './tries'
import type { Try, TryContext } from './tries/types'
import { createPanel } from './ui/Panel'

// ---------------------------------------------------------------- DOM
const canvas = document.getElementById('scene') as HTMLCanvasElement
const loading = document.getElementById('loading')!
const tryNoEl = document.getElementById('try-no')!
const tryTotalEl = document.getElementById('try-total')!
const tryTitleEl = document.getElementById('try-title')!
const trySummaryEl = document.getElementById('try-summary')!
const tryHintEl = document.getElementById('try-hint')!
const tryTagsEl = document.getElementById('try-tags')!
const tryFilesEl = document.getElementById('try-files')!
const dotsEl = document.getElementById('try-dots')!
const prevBtn = document.getElementById('try-prev') as HTMLButtonElement
const nextBtn = document.getElementById('try-next') as HTMLButtonElement
const fpsEl = document.getElementById('fps')!
const callsEl = document.getElementById('calls')!
const trisEl = document.getElementById('tris')!

// ---------------------------------------------------------------- 装配
// 只有四件东西：引擎、相机控制器、世界容器、试验上下文。
// 试验拿到的 ctx 就是它们，没有别的隐式依赖。
const engine = new Engine(canvas)
const orbit = new Orbit(engine.camera, canvas)
const world = new World(engine.scene, engine)

/** 试验时间：暂停与倍率只影响"世界的时间"，相机阻尼不受影响 */
const time = { paused: false, scale: 1 }
let tryClock = 0

const ctx: TryContext = {
  scene: engine.scene,
  renderer: engine.renderer,
  view: orbit,
  engine,
  world,
}

let currentIndex = -1
let currentTry: Try | null = null
let wireframe = false

// ---------------------------------------------------------------- 试验导航
tryTotalEl.textContent = String(TRIES.length)

const dots = TRIES.map((item, index) => {
  const dot = document.createElement('button')
  dot.className = 'try-dot'
  dot.type = 'button'
  dot.title = `${index + 1}. ${item.title}`
  dot.addEventListener('click', () => enterTry(index))
  dotsEl.appendChild(dot)
  return dot
})

/** 线框模式：遍历世界里的材质，有 wireframe 开关的全打开 */
function applyWireframe(): void {
  world.root.traverse((child) => {
    const holder = child as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
    if (!holder.material) return

    for (const material of Array.isArray(holder.material) ? holder.material : [holder.material]) {
      const toggleable = material as THREE.Material & { wireframe?: boolean }
      if (typeof toggleable.wireframe === 'boolean') toggleable.wireframe = wireframe
    }
  })
}

function updateCard(): void {
  const item = TRIES[currentIndex]
  if (!item) return

  tryNoEl.textContent = String(currentIndex + 1).padStart(2, '0')
  tryTitleEl.textContent = item.title
  trySummaryEl.textContent = item.summary
  tryHintEl.textContent = item.hint

  tryTagsEl.replaceChildren(
    ...item.tags.map((tag) => {
      const li = document.createElement('li')
      li.textContent = tag
      return li
    }),
  )

  tryFilesEl.replaceChildren(
    ...item.files.map((file) => {
      const li = document.createElement('li')
      li.textContent = file
      return li
    }),
  )

  dots.forEach((dot, index) => {
    dot.classList.toggle('is-current', index === currentIndex)
    dot.classList.toggle('is-done', index < currentIndex)
  })

  prevBtn.disabled = currentIndex === 0
  nextBtn.disabled = currentIndex === TRIES.length - 1
}

/**
 * 进入某个试验 —— 整个试验场的调度就这一处：
 *   拆掉上一个 → 还原引擎状态 → 装新的 → 摆机位 → 刷 UI
 */
function enterTry(index: number, force = false): void {
  if (TRIES.length === 0) return

  // 环形索引，越界自动绕回
  const next = ((index % TRIES.length) + TRIES.length) % TRIES.length
  if (next === currentIndex && currentTry && !force) return

  // 1. 拆：试验自己先收尾（事件、渲染目标），World 再兜底释放显存
  if (currentTry) {
    try {
      currentTry.dispose?.(ctx)
    } catch (error) {
      console.error(`[try ${currentTry.id}] dispose failed:`, error)
    }
  }
  world.clear()
  world.attachGui(panel.gui)

  // 2. 装
  currentIndex = next
  currentTry = TRIES[next]
  tryClock = 0

  // 单个试验 build 失败不该让整个页面白屏：报错、留空、照常更新 UI
  try {
    currentTry.build(ctx)
  } catch (error) {
    console.error(`[try ${currentTry.id}] build failed:`, error)
  }

  // 3. 机位与 UI
  const pose = currentTry.camera
  orbit.setPose(pose.radius, pose.theta, pose.phi, pose.target)
  applyWireframe()
  updateCard()
}

prevBtn.addEventListener('click', () => enterTry(currentIndex - 1))
nextBtn.addEventListener('click', () => enterTry(currentIndex + 1))

// ---------------------------------------------------------------- 面板
const panel = createPanel({
  time,
  onPrev: () => enterTry(currentIndex - 1),
  onNext: () => enterTry(currentIndex + 1),
  onReset: () => enterTry(currentIndex, true),
  onToggleWireframe: (on) => {
    wireframe = on
    applyWireframe()
  },
})

// 把 lil-gui 交给 World，试验才能用 world.folder() 往面板上挂参数
world.attachGui(panel.gui)

function refreshPanel(): void {
  panel.syncPaused()
  panel.gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
}

// ---------------------------------------------------------------- 快捷键
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase()

  if (e.key === 'ArrowRight') {
    enterTry(currentIndex + 1)
    return
  }
  if (e.key === 'ArrowLeft') {
    enterTry(currentIndex - 1)
    return
  }

  if (e.code === 'Space') {
    e.preventDefault()
    time.paused = !time.paused
    refreshPanel()
    return
  }

  if (key === 'r') {
    enterTry(currentIndex, true)
  } else if (key === 'w') {
    wireframe = !wireframe
    applyWireframe()
    panel.gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
  } else if (key === 'g') {
    const dom = panel.gui.domElement
    dom.style.display = dom.style.display === 'none' ? '' : 'none'
  }
})

// ---------------------------------------------------------------- 主循环
let fpsAccum = 0
let fpsFrames = 0
/** 渲染之后还要用到这一帧的 dt，先存一份 */
let frameDt = 0

engine.onUpdate((dt) => {
  frameDt = dt

  // 试验时间：暂停时静止，倍率只缩放"世界的时间"
  const tryDt = time.paused ? 0 : dt * time.scale
  tryClock += tryDt

  currentTry?.update?.(tryDt, tryClock, ctx)
  world.update(tryDt, tryClock)

  // 相机阻尼与暂停无关：暂停世界也还能转视角
  orbit.update(dt)
})

// 统计放在渲染完成之后读：renderer.info 只有整帧画完才是完整的
engine.onAfterRender(() => {
  fpsAccum += frameDt
  fpsFrames += 1
  if (fpsAccum < 0.5) return

  const info = engine.renderer.info
  fpsEl.textContent = String(Math.round(fpsFrames / fpsAccum))
  callsEl.textContent = String(info.render.calls)
  trisEl.textContent = info.render.triangles.toLocaleString('en-US')
  fpsAccum = 0
  fpsFrames = 0
})

engine.onResize((width, height) => world.resize(width, height))

// ---------------------------------------------------------------- 开发期调试接口
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__try = {
    engine,
    world,
    orbit,
    TRIES,
    enterTry,
    get index() {
      return currentIndex
    },
  }
}

// ---------------------------------------------------------------- 启动
engine.start()
enterTry(0)

requestAnimationFrame(() => loading.classList.add('hidden'))

// 热更新时把 GPU 资源交回去，否则每次改代码都会漏一点显存
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    currentTry?.dispose?.(ctx)
    world.clear()
    panel.dispose()
    orbit.dispose()
    engine.dispose()
  })
}
