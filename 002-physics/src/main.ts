import './style.css'
import * as THREE from 'three'
import { Engine } from './core/Engine'
import { PhysicsWorld } from './core/PhysicsWorld'
import { Stage } from './core/Stage'
import { CameraRig } from './core/CameraRig'
import { HALLS } from './halls'
import type { Hall, HallContext } from './halls/types'
import { createPanel } from './ui/Panel'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const loading = document.getElementById('loading')!
const hallNoEl = document.getElementById('hall-no')!
const hallTotalEl = document.getElementById('hall-total')!
const hallTitleEl = document.getElementById('hall-title')!
const hallDescEl = document.getElementById('hall-desc')!
const hallTagsEl = document.getElementById('hall-tags')!
const dotsEl = document.getElementById('hall-dots')!
const prevBtn = document.getElementById('hall-prev') as HTMLButtonElement
const nextBtn = document.getElementById('hall-next') as HTMLButtonElement
const fpsEl = document.getElementById('fps')!
const bodiesEl = document.getElementById('bodies')!
const drawCallsEl = document.getElementById('drawcalls')!

// ---------------- 初始化 ----------------
// Rapier 是 WASM，必须先把 init() await 完才能构造世界
const physics = await PhysicsWorld.create(-9.81)
const engine = new Engine(canvas)
const stage = new Stage(engine.scene, physics)
const rig = new CameraRig(engine.camera, canvas)

const ctx: HallContext = {
  stage,
  scene: engine.scene,
  physics,
  camera: rig,
}

// ---------------- 碰撞体线框 ----------------
const debugGeometry = new THREE.BufferGeometry()
const debugMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.85,
  depthTest: false,
})
const debugLines = new THREE.LineSegments(debugGeometry, debugMaterial)
debugLines.frustumCulled = false
debugLines.visible = false
debugLines.renderOrder = 999
engine.scene.add(debugLines)

function syncDebugLines(): void {
  if (!debugLines.visible) return

  const { vertices, colors } = physics.world.debugRender()
  debugGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  debugGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
}

// ---------------- 展厅切换 ----------------
hallTotalEl.textContent = String(HALLS.length)

let currentIndex = -1
let currentHall: Hall | null = null
let hallElapsed = 0

const dots = HALLS.map((hall, i) => {
  const dot = document.createElement('button')
  dot.className = 'hall-dot'
  dot.type = 'button'
  dot.title = `${i + 1}. ${hall.title}`
  dot.addEventListener('click', () => enterHall(i))
  dotsEl.appendChild(dot)
  return dot
})

function applyPose(hall: Hall): void {
  rig.setPose(hall.camera.radius, hall.camera.theta, hall.camera.phi, hall.camera.target)
}

function teardown(): void {
  // 顺序很重要：先让展厅和 Stage 放弃所有 body 引用，再整体重建物理世界
  currentHall?.dispose?.(ctx)
  stage.clear()
  physics.reset()
  physics.clearCollisionHandlers()
  hallElapsed = 0
}

function enterHall(index: number): void {
  if (HALLS.length === 0) return

  // 环形索引，越界自动绕回
  const next = ((index % HALLS.length) + HALLS.length) % HALLS.length
  if (next === currentIndex && currentHall) return

  teardown()

  currentIndex = next
  currentHall = HALLS[next]

  // 一个展厅 build 失败不应该让整个页面卡死，捕获后照常更新 UI
  try {
    currentHall.build(ctx)
  } catch (error) {
    console.error(`[hall ${currentHall.id}] build failed:`, String(error))
  }

  applyPose(currentHall)
  updateHallUi()
}

/** 按 R：清空重建同一个展厅，机位也复位 */
function rebuildCurrent(): void {
  if (!currentHall) return

  teardown()
  currentHall.build(ctx)
  applyPose(currentHall)
}

function updateHallUi(): void {
  const hall = HALLS[currentIndex]
  if (!hall) return

  hallNoEl.textContent = String(currentIndex + 1).padStart(2, '0')
  hallTitleEl.textContent = hall.title
  hallDescEl.textContent = hall.desc

  hallTagsEl.replaceChildren(
    ...hall.tags.map((tag) => {
      const li = document.createElement('li')
      li.textContent = tag
      return li
    }),
  )

  dots.forEach((dot, i) => {
    dot.classList.toggle('is-current', i === currentIndex)
    dot.classList.toggle('is-done', i < currentIndex)
  })

  prevBtn.disabled = currentIndex === 0
  nextBtn.disabled = currentIndex === HALLS.length - 1
}

prevBtn.addEventListener('click', () => enterHall(currentIndex - 1))
nextBtn.addEventListener('click', () => enterHall(currentIndex + 1))

// ---------------- 点击扔球 ----------------
const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()
let downPoint: { x: number; y: number } | null = null

function throwBall(clientX: number, clientY: number): void {
  pointerNdc.x = (clientX / window.innerWidth) * 2 - 1
  pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointerNdc, engine.camera)

  const dir = raycaster.ray.direction
  const start = raycaster.ray.origin.clone().addScaledVector(dir, 4)

  const body = stage.spawn({
    shape: { kind: 'ball', radius: 0.42 },
    position: [start.x, start.y, start.z],
    color: '#ff4d6d',
    density: 3.2,
    restitution: 0.45,
    friction: 0.6,
    // 30 m/s 的球一个子步能飞 0.5 米，不开 CCD 会直接穿墙
    ccd: true,
    noSleep: true,
  })

  const speed = 30
  body.setLinvel({ x: dir.x * speed, y: dir.y * speed + 2.5, z: dir.z * speed }, true)
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) downPoint = { x: e.clientX, y: e.clientY }
})

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !downPoint) return

  const moved = Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y)
  downPoint = null

  // 拖动超过 6px 当成旋转相机，不算点击
  if (moved > 6) return
  throwBall(e.clientX, e.clientY)
})

// ---------------- 面板 ----------------
const panel = createPanel({
  physics,
  onReset: rebuildCurrent,
  onPrev: () => enterHall(currentIndex - 1),
  onNext: () => enterHall(currentIndex + 1),
  onToggleDebug: (on) => {
    debugLines.visible = on
  },
})

// ---------------- 快捷键 ----------------
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase()

  if (e.key === 'ArrowRight') {
    enterHall(currentIndex + 1)
  } else if (e.key === 'ArrowLeft') {
    enterHall(currentIndex - 1)
  } else if (key === 'r') {
    rebuildCurrent()
  } else if (e.code === 'Space') {
    e.preventDefault()
    physics.paused = !physics.paused
    panel.syncPaused()
    panel.gui.controllersRecursive().forEach((c) => c.updateDisplay())
  }
})

// ---------------- 主循环 ----------------
let fpsAccum = 0
let fpsFrames = 0

engine.onUpdate((dt) => {
  physics.step(dt)
  currentHall?.update?.(dt, hallElapsed, ctx)

  stage.sync()
  rig.update(dt)
  syncDebugLines()

  hallElapsed += dt

  fpsAccum += dt
  fpsFrames += 1
  if (fpsAccum >= 0.5) {
    fpsEl.textContent = String(Math.round(fpsFrames / fpsAccum))
    bodiesEl.textContent = String(physics.bodyCount)
    drawCallsEl.textContent = String(stage.drawCalls)
    fpsAccum = 0
    fpsFrames = 0
  }
})

// ---------------- 开发期调试接口 ----------------
// 截图脚本靠它把场景真实状态读回去，比盯着像素猜靠谱得多
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__museum = { stage, physics, engine, rig, HALLS }
}

// ---------------- 启动 ----------------
engine.start()
enterHall(0)

requestAnimationFrame(() => loading.classList.add('hidden'))

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    teardown()
    panel.dispose()
    rig.dispose()
    engine.dispose()
  })
}
