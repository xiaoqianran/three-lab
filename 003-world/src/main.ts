import './style.css'
import type * as THREE from 'three'
import { CameraRig } from './core/CameraRig'
import { Engine } from './core/Engine'
import { World } from './core/World'
import { CHAPTERS } from './chapters'
import type { Chapter, ChapterContext } from './chapters/types'
import { createPanel } from './ui/Panel'
import { createSourceViewer } from './ui/SourceViewer'

// ---------------------------------------------------------------- DOM
const canvas = document.getElementById('scene') as HTMLCanvasElement
const loading = document.getElementById('loading')!
const chapterNoEl = document.getElementById('chapter-no')!
const chapterTotalEl = document.getElementById('chapter-total')!
const chapterTitleEl = document.getElementById('chapter-title')!
const chapterDescEl = document.getElementById('chapter-desc')!
const chapterApisEl = document.getElementById('chapter-apis')!
const chapterFilesEl = document.getElementById('chapter-files')!
const dotsEl = document.getElementById('chapter-dots')!
const prevBtn = document.getElementById('chapter-prev') as HTMLButtonElement
const nextBtn = document.getElementById('chapter-next') as HTMLButtonElement
const fpsEl = document.getElementById('fps')!
const callsEl = document.getElementById('calls')!
const trisEl = document.getElementById('tris')!
const objsEl = document.getElementById('objs')!

// ---------------------------------------------------------------- 装配
// 只有四个东西：渲染引擎、轨道相机、世界容器、章节上下文。
// 章节拿到的 ctx 就是它们，不再有别的隐式依赖。
const engine = new Engine(canvas)
const rig = new CameraRig(engine.camera, canvas)
const world = new World(engine.scene, engine)

/** 章节时间状态：暂停与倍率都只影响"世界的时间"，不影响相机阻尼 */
const time = { paused: false, scale: 1 }
let chapterClock = 0

const ctx: ChapterContext = {
  scene: engine.scene,
  renderer: engine.renderer,
  camera: rig,
  engine,
  world,
}

const sourceViewer = createSourceViewer(document.getElementById('source') as HTMLElement)

let currentIndex = -1
let currentChapter: Chapter | null = null
let wireframe = false

// ---------------------------------------------------------------- 章节导航
chapterTotalEl.textContent = String(CHAPTERS.length)

const dots = CHAPTERS.map((chapter, index) => {
  const dot = document.createElement('button')
  dot.className = 'chapter-dot'
  dot.type = 'button'
  dot.title = `${index + 1}. ${chapter.title}`
  dot.addEventListener('click', () => enterChapter(index))
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
  const chapter = CHAPTERS[currentIndex]
  if (!chapter) return

  chapterNoEl.textContent = String(currentIndex + 1).padStart(2, '0')
  chapterTitleEl.textContent = chapter.title
  chapterDescEl.textContent = chapter.summary

  chapterApisEl.replaceChildren(
    ...chapter.apis.map((api) => {
      const item = document.createElement('li')
      item.textContent = api
      return item
    }),
  )

  // 文件列表可点：点一下就在源码面板里打开对应文件
  chapterFilesEl.replaceChildren(
    ...chapter.files.map((file) => {
      const item = document.createElement('li')
      item.textContent = file
      item.addEventListener('click', () => sourceViewer.open(file))
      return item
    }),
  )

  dots.forEach((dot, index) => {
    dot.classList.toggle('is-current', index === currentIndex)
    dot.classList.toggle('is-done', index < currentIndex)
  })

  prevBtn.disabled = currentIndex === 0
  nextBtn.disabled = currentIndex === CHAPTERS.length - 1
}

/**
 * 进入某一章 —— 这个函数就是整个 lab 的"调度器"：
 *   拆掉上一章 → 还原引擎状态 → 装上新的一章 → 摆好机位 → 刷新 UI
 */
function enterChapter(index: number, force = false): void {
  if (CHAPTERS.length === 0) return

  // 环形索引，越界自动绕回
  const next = ((index % CHAPTERS.length) + CHAPTERS.length) % CHAPTERS.length
  if (next === currentIndex && currentChapter && !force) return

  // 1. 拆：章节自己先清理非场景图资源，World 再兜底释放显存
  if (currentChapter) {
    try {
      currentChapter.dispose?.(ctx)
    } catch (error) {
      console.error(`[chapter ${currentChapter.id}] dispose failed:`, error)
    }
  }
  world.clear()
  world.attachGui(panel.gui)

  // 2. 装
  currentIndex = next
  currentChapter = CHAPTERS[next]
  chapterClock = 0

  // 单章 build 失败不应该让整个页面白屏：报错、留空、照常更新 UI
  try {
    currentChapter.build(ctx)
  } catch (error) {
    console.error(`[chapter ${currentChapter.id}] build failed:`, error)
  }

  // 3. 机位与 UI
  const pose = currentChapter.camera
  rig.setPose(pose.radius, pose.theta, pose.phi, pose.target)
  applyWireframe()
  updateCard()
  sourceViewer.show(currentChapter.files)
}

prevBtn.addEventListener('click', () => enterChapter(currentIndex - 1))
nextBtn.addEventListener('click', () => enterChapter(currentIndex + 1))

// ---------------------------------------------------------------- 面板
const panel = createPanel({
  camera: rig,
  time,
  onPrev: () => enterChapter(currentIndex - 1),
  onNext: () => enterChapter(currentIndex + 1),
  onReset: () => enterChapter(currentIndex, true),
  onToggleWireframe: (on) => {
    wireframe = on
    applyWireframe()
  },
  onToggleSource: (on) => sourceViewer.setVisible(on),
})

// 把 lil-gui 交给 World，章节才能用 world.folder() 往面板上挂参数
world.attachGui(panel.gui)

/** 快捷键改过的开关，要让面板上的控件"对表" */
function refreshPanel(): void {
  panel.syncAutoRotate()
  panel.syncPaused()
  panel.gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
}

// ---------------------------------------------------------------- 快捷键
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase()

  switch (e.key) {
    case 'ArrowRight':
      enterChapter(currentIndex + 1)
      return
    case 'ArrowLeft':
      enterChapter(currentIndex - 1)
      return
  }

  if (e.code === 'Space') {
    e.preventDefault()
    time.paused = !time.paused
    refreshPanel()
    return
  }

  if (key === 'r') {
    enterChapter(currentIndex, true)
  } else if (key === 'c') {
    sourceViewer.toggle()
    panel.gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
  } else if (key === 'w') {
    wireframe = !wireframe
    applyWireframe()
    panel.gui.controllersRecursive().forEach((controller) => controller.updateDisplay())
  } else if (key === 'a') {
    rig.autoRotate = !rig.autoRotate
    refreshPanel()
  }
})

// ---------------------------------------------------------------- 主循环
let fpsAccum = 0
let fpsFrames = 0
/** 渲染之后还要用到这一帧的 dt（比如统计 FPS），先存一份 */
let frameDt = 0

engine.onUpdate((dt) => {
  frameDt = dt

  // 章节时间：暂停时静止，倍率只缩放"世界的时间"
  const chapterDt = time.paused ? 0 : dt * time.scale
  chapterClock += chapterDt

  currentChapter?.update?.(chapterDt, chapterClock, ctx)
  world.update(chapterDt, chapterClock)

  // 相机阻尼与暂停无关：暂停世界也还能转视角
  rig.update(dt)
})

// 统计放在"渲染完成"之后读：renderer.info 只有整帧画完才是完整的
// （一帧里可能渲染多次：阴影贴图、后处理链、镜面反射……）
engine.onAfterRender(() => {
  fpsAccum += frameDt
  fpsFrames += 1
  if (fpsAccum < 0.5) return

  // 半秒统计一次，数字才不会跳得看不清
  const info = engine.renderer.info
  fpsEl.textContent = String(Math.round(fpsFrames / fpsAccum))
  callsEl.textContent = String(info.render.calls)
  trisEl.textContent = info.render.triangles.toLocaleString('en-US')
  objsEl.textContent = String(info.memory.geometries)
  fpsAccum = 0
  fpsFrames = 0
})

engine.onResize((width, height) => world.resize(width, height))

// ---------------------------------------------------------------- 开发期调试接口
// 截图脚本靠它直接跳章，比一路按方向键稳得多
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__world = {
    engine,
    world,
    rig,
    CHAPTERS,
    enterChapter,
    get index() {
      return currentIndex
    },
  }
}

// ---------------------------------------------------------------- 启动
engine.start()
enterChapter(0)

requestAnimationFrame(() => loading.classList.add('hidden'))

// 热更新时把 GPU 资源交回去，否则每次改代码都会漏一点显存
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    currentChapter?.dispose?.(ctx)
    world.clear()
    sourceViewer.dispose()
    panel.dispose()
    rig.dispose()
    engine.dispose()
  })
}
