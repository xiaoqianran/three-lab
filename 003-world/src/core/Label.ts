import * as THREE from 'three'

// Linux / 容器里没有 PingFang，必须把 Noto Sans CJK 列进候选，否则中文会渲染成方块
const FONT_STACK =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", ui-sans-serif, sans-serif'

export interface LabelOptions {
  /** 文字颜色 */
  color?: string
  /** 底板颜色，传 null 表示不要底板 */
  background?: string | null
  /** 世界空间里的文字高度 */
  size?: number
  /** 字号（像素），影响清晰度 */
  fontSize?: number
}

/**
 * 世界空间里的文字标签。
 *
 * 做法：先把文字画到 canvas，再做成 CanvasTexture 贴到 Sprite 上。
 * Sprite 的特别之处是**永远正对相机**，所以它是"3D 场景里的标签"最省事的载体。
 */
export function createLabel(text: string, options: LabelOptions = {}): THREE.Sprite {
  const { color = '#e8eeff', background = 'rgba(10, 14, 24, 0.72)', size = 0.42, fontSize = 44 } = options

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[label] 拿不到 2D 上下文')

  const font = `600 ${fontSize}px ${FONT_STACK}`
  // 先量一次宽度，画布才能正好装下文字
  ctx.font = font
  const paddingX = 26
  const paddingY = 14
  const textWidth = Math.ceil(ctx.measureText(text).width)

  canvas.width = textWidth + paddingX * 2
  canvas.height = fontSize + paddingY * 2

  // 改过 canvas 尺寸后上下文会被重置，字体要重新设一遍
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (background) {
    ctx.fillStyle = background
    // 圆角矩形底板
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
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      // 关掉深度写入，标签之间不会互相遮挡出黑边
      depthWrite: false,
    }),
  )

  // 按画布比例给出世界尺寸，文字才不会被拉扁
  const aspect = canvas.width / canvas.height
  sprite.scale.set(size * aspect, size, 1)
  return sprite
}
