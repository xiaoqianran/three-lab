import * as THREE from 'three'

// Linux / 容器里没有 PingFang，必须把 Noto Sans CJK 列进候选，否则中文会渲染成方块
const FONT_STACK =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", ui-sans-serif, sans-serif'

/* ------------------------------------------------------------------ 材质 */

/**
 * 常用材质的简写。
 * 拿不准用什么材质时就先用它 —— 它是不受光就黑、受光就正常的那种标准材质。
 */
export function mat(
  color: THREE.ColorRepresentation,
  options: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.15, ...options })
}

/** 会发光的材质（泛光后处理里特别好看） */
export function glowMat(color: THREE.ColorRepresentation, intensity = 1.4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x101828,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: 0.3,
  })
}

/* ------------------------------------------------------------------ 贴图 */

/** 现场画一张贴图：不需要任何素材文件，画什么就是什么 */
export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[kit] 拿不到 2D 上下文')
  draw(ctx, width, height)

  const texture = new THREE.CanvasTexture(canvas)
  // 颜色贴图必须声明是 sRGB，否则渲染器按线性数据解释，画面发灰
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/* ------------------------------------------------------------------ 文字 */

export interface LabelOptions {
  color?: string
  background?: string | null
  /** 世界空间里的文字高度 */
  size?: number
  fontSize?: number
}

/**
 * 世界空间里的文字标签。
 * 做法是把文字画到 canvas 做成贴图，再贴到 Sprite 上 —— Sprite 永远正对相机，
 * 所以它是"3D 场景里的标签"最省事的载体。
 */
export function label(text: string, options: LabelOptions = {}): THREE.Sprite {
  const { color = '#e8eeff', background = 'rgba(10, 14, 24, 0.7)', size = 0.42, fontSize = 44 } = options

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[kit] 拿不到 2D 上下文')

  const font = `600 ${fontSize}px ${FONT_STACK}`
  ctx.font = font
  const paddingX = 26
  const paddingY = 14
  const textWidth = Math.ceil(ctx.measureText(text).width)

  canvas.width = textWidth + paddingX * 2
  canvas.height = fontSize + paddingY * 2

  // 改过 canvas 尺寸后上下文会重置，字体要重新设一遍
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (background) {
    ctx.fillStyle = background
    const r = canvas.height / 2
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.lineTo(canvas.width - r, 0)
    ctx.arcTo(canvas.width, 0, canvas.width, r, r)
    ctx.lineTo(canvas.width, canvas.height - r)
    ctx.arcTo(canvas.width, canvas.height, canvas.width - r, canvas.height, r)
    ctx.lineTo(r, canvas.height)
    ctx.arcTo(0, canvas.height, 0, canvas.height - r, r)
    ctx.lineTo(0, r)
    ctx.arcTo(0, 0, r, 0, r)
    ctx.closePath()
    ctx.fill()
  }

  ctx.fillStyle = color
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  )
  // 按画布比例给世界尺寸，文字才不会被拉扁
  sprite.scale.set(size * (canvas.width / canvas.height), size, 1)
  return sprite
}

/* ------------------------------------------------------------------ 随机 */

/** [min, max) 之间的随机数 */
export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** 从数组里随机取一个 */
export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/* ------------------------------------------------------------------ 缓动 */

export type EaseFn = (t: number) => number

/**
 * 缓动函数：输入 0~1 的进度，输出 0~1 的"位置比例"。
 * 输出**允许超出** 0~1（回弹类就是这样），这正好能做出"冲过头再弹回来"的感觉。
 */
export const ease: Record<string, EaseFn> = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  cubicOut: (t) => 1 - (1 - t) ** 3,
  // 先往回缩一下再冲出去
  backOut: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  },
  // 弹簧：会来回震荡几次才停下
  elasticOut: (t) => {
    if (t === 0 || t === 1) return t
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
  },
}

/** 最常用的一行公式：位置 = 起点 + (终点 - 起点) × 进度 */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}
