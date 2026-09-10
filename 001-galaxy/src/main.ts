import './style.css'
import * as THREE from 'three'
import { Engine } from './core/Engine'
import { CameraRig } from './core/CameraRig'
import { createGalaxy, defaultParams } from './scene/Galaxy'
import { createStarfield } from './scene/Starfield'
import { createCoreGlow } from './scene/CoreGlow'
import { createPostFX, defaultBloomParams } from './scene/PostFX'
import { createSatellite, defaultSatelliteParams } from './scene/Satellite'
import { createPanel, type QualityState } from './ui/Panel'
import { Tour } from './tour/Tour'
import { createTourUI, type TourUIHandle } from './tour/TourUI'
import { INITIAL_STATE, TOUR_STEPS, type StageState } from './tour/steps'
import { FLASH_COUNT } from './scene/Galaxy'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const loading = document.getElementById('loading')!
const fpsEl = document.getElementById('fps')!
const countEl = document.getElementById('count')!
const hudEl = document.getElementById('hud')!

// ---------------- 装配 ----------------
const engine = new Engine(canvas)
const rig = new CameraRig(engine.camera, canvas, defaultParams.radius * 1.35)

const starfield = createStarfield(9000, 1400)
engine.scene.add(starfield.points)

const galaxy = createGalaxy(defaultParams, engine.pixelRatio)
engine.scene.add(galaxy.points)
engine.scene.add(galaxy.dust)
engine.scene.add(galaxy.companion)
galaxy.companion.visible = false

const satellite = createSatellite(defaultSatelliteParams, engine.pixelRatio)
engine.scene.add(satellite.points)

const core = createCoreGlow(defaultParams.colorCore, 1.15, 3.6)
engine.scene.add(core.mesh)

const post = createPostFX(engine.renderer, engine.scene, engine.camera, defaultBloomParams)
post.sync()
engine.composer = post.composer

// ---------------- 画质 / 预设 / 输出 ----------------
const quality: QualityState = { adaptive: false }
let renderScale = 1

/** 形态预设：改一组结构参数后重建粒子 */
const PRESETS: Partial<typeof defaultParams>[] = [
  // M51：经典双旋臂
  { arms: 2, armStrength: 0.86, armTightness: 2.1, thickness: 0.62, shear: 0.55, noiseAmp: 0.42, spin: 0.15 },
  // 银河系：棒旋四臂，盘面更薄更规整
  { arms: 4, armStrength: 0.72, armTightness: 1.35, thickness: 0.46, shear: 0.4, noiseAmp: 0.5, spin: 0.13 },
  // 仙女座：缠绕极紧，接近环状
  { arms: 2, armStrength: 0.5, armTightness: 3.6, thickness: 0.32, shear: 0.75, noiseAmp: 0.3, spin: 0.18 },
  // 星暴：几乎没有旋臂结构，被湍流主导
  { arms: 3, armStrength: 0.42, armTightness: 0.9, thickness: 0.95, shear: 0.6, noiseAmp: 1.15, spin: 0.2 },
]

function applyPreset(index: number): void {
  const preset = PRESETS[index]
  if (!preset) return

  Object.assign(defaultParams, preset)
  galaxy.syncUniforms()
  galaxy.rebuild(defaultParams.count)
  panel.gui.controllersRecursive().forEach((c) => c.updateDisplay())
}

function download(url: string, filename: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
}

let screenshotPending = false
let recorder: MediaRecorder | null = null

function requestScreenshot(): void {
  screenshotPending = true
}

// 截图必须紧跟渲染，否则 WebGL 的 drawingBuffer 已经被清空
engine.onAfterRender(() => {
  if (!screenshotPending) return
  screenshotPending = false
  download(canvas.toDataURL('image/png'), `galaxy-${Date.now()}.png`)
})

function toggleRecording(): void {
  if (recorder) {
    recorder.stop()
    return
  }

  try {
    const stream = canvas.captureStream(60)
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

    const next = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
    let chunks: Blob[] = []

    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }

    next.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      download(url, `galaxy-${Date.now()}.webm`)
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      chunks = []
      recorder = null
    }

    next.start()
    recorder = next
  } catch (error) {
    console.warn('[three-lab] 当前环境不支持录屏', error)
    recorder = null
  }
}

const panel = createPanel({
  params: defaultParams,
  bloomParams: defaultBloomParams,
  quality,
  galaxy,
  post,
  rig,
  core,
  onCountChange: (count) => {
    countEl.textContent = count.toLocaleString('en-US')
  },
  onReset: () => rig.reset(defaultParams.radius * 1.35),
  onPreset: applyPreset,
  onScreenshot: requestScreenshot,
  onToggleRecording: toggleRecording,
  isRecording: () => recorder !== null,
})

countEl.textContent = defaultParams.count.toLocaleString('en-US')

// ---------------- 分步演示 ----------------
// 演示结束后时间要继续走，所以这几个值在 main 这边留一份。
// 演示结束后每帧仍然会 apply 一次，这样面板上改参数能立刻生效。
let lastAnimTime = 0
let lastSpinPhase = 0
// 起点必须是"什么都没有"，否则加载遮罩淡出的那一瞬间会先闪一下完整星系
let lastState: StageState = { ...INITIAL_STATE }

let tourUI: TourUIHandle | null = null

// ---------------- 交互引力源 ----------------
const POINTER_STRENGTH = 6

/** 自动演示引力源的那一步（按声明查找，避免步骤调整后下标错位） */
const POINTER_STEP_INDEX = TOUR_STEPS.findIndex((step) => 'pointer' in step.state)

const raycaster = new THREE.Raycaster()
const pointerPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const pointerWorld = new THREE.Vector3()
const pointerNdc = new THREE.Vector2()

let pointerActive = false
/** 用户一旦自己动过，就不再播放自动演示 */
let pointerManual = false
let pointerAutoTime = 0
let pointerEngaged = false

function projectPointer(clientX: number, clientY: number): void {
  pointerNdc.x = (clientX / window.innerWidth) * 2 - 1
  pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointerNdc, engine.camera)

  const hit = raycaster.ray.intersectPlane(pointerPlane, pointerWorld)
  if (!hit) {
    // 视线几乎贴着盘面时射线与平面平行，退化成沿视线取一点
    raycaster.ray.at(engine.camera.position.length(), pointerWorld)
  }
}

// ---------------- 超新星 ----------------
const flashPositions = galaxy.uniforms.uFlashPos.value as THREE.Vector3[]
const flashAges = galaxy.uniforms.uFlashAge.value as Float32Array

/** 每个槽位的轨道参数：闪光必须跟着星系一起公转，否则会掉队到空旷处 */
const flashOrbit = Array.from({ length: FLASH_COUNT }, () => ({
  a0: 0,
  radius: 0,
  omega: 0,
  y: 0,
}))
let flashCursor = 0
let flashTimer = 0

function spawnSupernova(): void {
  const idx = flashCursor++ % FLASH_COUNT

  const radius = 2.5 + Math.random() * 8.5
  const rn = Math.min(1, radius / defaultParams.radius)
  const tilt = defaultParams.armTightness * Math.log(1 + rn * 3.2)
  const armCount = Math.max(1, Math.round(defaultParams.arms))
  const arm = Math.floor(Math.random() * armCount)

  flashOrbit[idx].a0 = tilt + (arm / armCount) * Math.PI * 2
  flashOrbit[idx].radius = radius
  flashOrbit[idx].omega = defaultParams.spin * (1 + defaultParams.shear / (rn * 3.2 + 1))
  flashOrbit[idx].y = (Math.random() - 0.5) * 0.8

  flashAges[idx] = 0
}

function updateSupernovas(dt: number, spinPhase: number, strength: number): void {
  for (let i = 0; i < FLASH_COUNT; i++) {
    if (flashAges[i] <= 1) flashAges[i] += dt * 0.55
  }

  // 让已点燃的闪光跟随星系一起公转
  for (let i = 0; i < FLASH_COUNT; i++) {
    const o = flashOrbit[i]
    const ang = o.a0 + o.omega * spinPhase
    flashPositions[i].set(Math.cos(ang) * o.radius, o.y, Math.sin(ang) * o.radius)
  }

  if (strength <= 0.01) return

  flashTimer -= dt
  if (flashTimer > 0) return

  flashTimer = 1.1 + Math.random() * 2.4
  spawnSupernova()
}

// ---------------- 星系碰撞 ----------------
const companionOffset = new THREE.Vector3()
/** 两个星系的距离包络：越近潮汐越强 */
let companionEnvelope = 0
/** 循环两端用来淡入淡出，避免伴星系突然出现或消失 */
let companionFade = 0
let collisionPhase = 0

function updateCollision(dt: number, strength: number): void {
  const active = strength > 0.005
  galaxy.companion.visible = active

  if (!active) {
    companionEnvelope = 0
    companionFade = 0
    return
  }

  collisionPhase = (collisionPhase + dt * 0.055) % 1
  const t = collisionPhase

  // 一条微微弯曲的掠过轨迹：从远处进来、穿过主星系、飞到另一侧
  companionOffset.set(-52 + 104 * t, 10 - 20 * t + Math.sin(t * Math.PI) * 5, -26 + 52 * t)

  const dist = companionOffset.length()
  companionEnvelope = Math.exp(-(dist * dist) / 900)
  companionFade = Math.min(1, t * 6) * Math.min(1, (1 - t) * 6)

  galaxy.companionUniforms.uBodyOffset.value.copy(companionOffset)
}

/** 把插值后的权重铺到各个图层上 */
function applyStage(s: StageState, spinPhase: number, animTime: number): void {
  const u = galaxy.uniforms
  const d = galaxy.dustUniforms
  const c = galaxy.companionUniforms

  // 第 1 步是完全空场景，直接跳过整批粒子的绘制
  galaxy.points.visible = s.opacity > 0.005
  galaxy.dust.visible = s.dust > 0.005

  // ---- 恒星层 ----
  u.uOpacity.value = s.opacity
  u.uArmBlend.value = s.armBlend
  u.uThicknessBlend.value = s.thickness
  u.uNoiseBlend.value = s.noise
  u.uColorBlend.value = s.color
  u.uSoftBlend.value = s.soft
  u.uAgeBlend.value = s.age * defaultParams.ageStrength
  u.uSpike.value = s.spike * defaultParams.spikeStrength
  u.uCollapseBlend.value = s.collapse
  u.uDofStrength.value = s.dof * defaultParams.dofStrength
  // 景深自动对焦到原点：焦平面距离就是相机到星系中心的距离
  const focusDistance = engine.camera.position.length()
  u.uFocusDistance.value = focusDistance
  d.uFocusDistance.value = focusDistance
  c.uFocusDistance.value = focusDistance
  u.uSpinPhase.value = spinPhase
  u.uAnimTime.value = animTime

  // ---- 尘埃层：形态跟着恒星走，只有显隐单独由 dust 权重控制 ----
  d.uOpacity.value = s.dust * defaultParams.dustStrength
  d.uArmBlend.value = s.armBlend
  d.uThicknessBlend.value = s.thickness
  d.uNoiseBlend.value = s.noise
  d.uColorBlend.value = s.color
  d.uCollapseBlend.value = s.collapse
  d.uDofStrength.value = s.dof * defaultParams.dofStrength
  d.uSpinPhase.value = spinPhase
  d.uAnimTime.value = animTime

  // ---- 引力源：两层共享同一个位置，但只有真正激活时才施加 ----
  const pointerStrength = s.pointer * (pointerEngaged ? POINTER_STRENGTH : 0)
  u.uPointerPos.value.copy(pointerWorld)
  u.uPointerStrength.value = pointerStrength
  d.uPointerPos.value.copy(pointerWorld)
  d.uPointerStrength.value = pointerStrength

  // ---- 伴星系：形态跟随主星系，位置与潮汐由碰撞逻辑接管 ----
  c.uOpacity.value = s.collision * companionFade
  c.uArmBlend.value = s.armBlend
  c.uThicknessBlend.value = s.thickness
  c.uNoiseBlend.value = s.noise
  c.uColorBlend.value = s.color
  c.uSoftBlend.value = s.soft
  c.uAgeBlend.value = s.age
  c.uCollapseBlend.value = s.collapse
  c.uDofStrength.value = s.dof * defaultParams.dofStrength
  c.uSpinPhase.value = spinPhase
  c.uAnimTime.value = animTime

  // ---- 超新星只照亮恒星，尘埃和伴星系本身不额外发光 ----
  u.uFlashStrength.value = s.supernova
  d.uFlashStrength.value = 0
  c.uFlashStrength.value = 0

  // ---- 潮汐拉扯：两个星系的引力中心互相拽对方的粒子 ----
  const tidal = s.collision * companionEnvelope
  u.uOtherCenter.value.copy(companionOffset)
  u.uTidalStrength.value = tidal * 5.5
  d.uOtherCenter.value.copy(companionOffset)
  d.uTidalStrength.value = tidal * 5.5
  c.uOtherCenter.value.set(0, 0, 0)
  c.uTidalStrength.value = tidal * 3

  // ---- 卫星星系 ----
  satellite.points.visible = s.satellite > 0.005
  satellite.uniforms.uSatOpacity.value = s.satellite
  satellite.uniforms.uTime.value = animTime

  starfield.setOpacity(s.starfield)

  core.uniforms.uIntensity.value = s.core * 1.15
  core.mesh.visible = s.core > 0.01

  post.stageBlend.bloom = s.bloom
  post.stageBlend.grade = s.grade
  post.sync()

  panel.setOpacity(s.gui)
}

const tour = new Tour({
  onStep: (index, step) => tourUI?.setStep(index, step),
  onFinish: () => {
    tourUI?.hide()
    hudEl.classList.remove('is-dimmed')
    // 中途跳过时面板可能还没淡入过，这里兜底
    panel.setOpacity(1)
  },
  setCamera: (radius, theta, phi) => rig.setGoal(radius, theta, phi),
  apply: (state, spinPhase, animTime) => {
    lastState = state
    lastAnimTime = animTime
    lastSpinPhase = spinPhase
    applyStage(state, spinPhase, animTime)
  },
})

tourUI = createTourUI(tour)

// ---------------- 每帧 ----------------
let fpsAccum = 0
let fpsFrames = 0
let lastPlaying: boolean | null = null

engine.onUpdate((dt, elapsed) => {
  // ---- 碰撞：先推进轨道，紧接着的 applyStage 要用到这一帧的距离包络 ----
  updateCollision(dt, lastState.collision)

  // ---- 引力源：演示到那一步时自动巡游一段，用户一动就交还控制权 ----
  const autoPointer =
    tour.isActive && tour.currentIndex === POINTER_STEP_INDEX && !pointerManual
  pointerEngaged = pointerActive || autoPointer

  if (autoPointer) {
    pointerAutoTime += dt
    const t = pointerAutoTime * 0.5
    const orbit = 7.5
    pointerWorld.set(Math.cos(t) * orbit, 0, Math.sin(t * 1.7) * orbit * 0.75)
  }

  if (tour.isActive) {
    tour.update(dt)
    tourUI?.setProgress(tour.progress)

    if (tour.playing !== lastPlaying) {
      lastPlaying = tour.playing
      tourUI?.setPlaying(tour.playing)
    }
  } else {
    // 演示结束后接管：时间继续推进，并且每帧重铺一次权重，
    // 这样面板上的改动（尘埃浓度、星芒强度等）能立刻体现
    const scale = defaultParams.timeScale
    lastAnimTime += dt * scale
    lastSpinPhase += dt * scale
    applyStage(lastState, lastSpinPhase, lastAnimTime)
  }

  updateSupernovas(dt, lastSpinPhase, lastState.supernova)
  // 权重为 0 时卫星停住，不会白白消耗时间
  satellite.update(dt * lastState.satellite)

  core.update(dt, elapsed, engine.camera)
  rig.update(dt)
  post.update(dt, elapsed)

  fpsAccum += dt
  fpsFrames += 1
  if (fpsAccum >= 0.5) {
    const fps = fpsFrames / fpsAccum
    fpsEl.textContent = String(Math.round(fps))

    // 自适应画质：掉帧就降采样，回血就慢慢加回来
    if (quality.adaptive) {
      if (fps < 42) renderScale = Math.max(0.4, renderScale - 0.12)
      else if (fps > 56) renderScale = Math.min(1, renderScale + 0.06)
      engine.setRenderScale(renderScale)
    } else if (renderScale !== 1) {
      renderScale = 1
      engine.setRenderScale(1)
    }

    fpsAccum = 0
    fpsFrames = 0
  }
})

engine.onResize(() => {
  galaxy.uniforms.uPixelRatio.value = engine.pixelRatio
  galaxy.dustUniforms.uPixelRatio.value = engine.pixelRatio
  galaxy.companionUniforms.uPixelRatio.value = engine.pixelRatio
  satellite.uniforms.uPixelRatio.value = engine.pixelRatio
})

// ---------------- 快捷键 ----------------
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase()

  if (e.code === 'Space') {
    e.preventDefault()
    if (tour.isActive) {
      tour.togglePlay()
    } else {
      rig.autopilot = !rig.autopilot
      panel.gui.controllersRecursive().forEach((c) => c.updateDisplay())
    }
    return
  }

  if (e.key === 'ArrowRight') {
    if (tour.isActive) tour.next()
    return
  }

  if (e.key === 'ArrowLeft') {
    if (tour.isActive) tour.prev()
    return
  }

  if (e.key === 'Escape') {
    if (tour.isActive) tour.finish()
    return
  }

  if (key === 'h') {
    panel.toggle()
  } else if (key === 'r') {
    rig.reset(defaultParams.radius * 1.35)
  } else if (key === 't') {
    // 重播演示
    hudEl.classList.add('is-dimmed')
    tourUI?.show()
    panel.setOpacity(0)
    tour.start()
  }
})

// ---------------- 引力源交互（按住右键） ----------------
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return
  pointerActive = true
  pointerManual = true
  projectPointer(e.clientX, e.clientY)
})

canvas.addEventListener('pointermove', (e) => {
  if (!pointerActive) return
  projectPointer(e.clientX, e.clientY)
})

// 绑在 window 上，鼠标拖出画布再松开也能正确释放
window.addEventListener('pointerup', (e) => {
  if (e.button === 2) pointerActive = false
})

// ---------------- 启动 ----------------
// 预热一次 shader 编译，避免开场卡顿（r180 起 compile 是异步的）
void engine.renderer.compile(engine.scene, engine.camera)
engine.start()

hudEl.classList.add('is-dimmed')

requestAnimationFrame(() => {
  loading.classList.add('hidden')
  // 等遮罩淡出一点再开演，避免第一步被盖住
  window.setTimeout(() => tour.start(), 800)
})

// 热更新时清理资源
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (recorder && recorder.state === 'recording') recorder.stop()
    tourUI?.dispose()
    panel.dispose()
    post.dispose()
    core.dispose()
    galaxy.dispose()
    satellite.dispose()
    starfield.dispose()
    rig.dispose()
    engine.dispose()
  })
}
