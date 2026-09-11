import * as THREE from 'three'

/**
 * 用 2D canvas 现场画一张贴图。
 *
 * 为什么需要它：这个 lab 不依赖任何素材文件，纹理全部"当场画出来"。
 * 好处是能看清 Texture 的本质 —— 它就是一张位图 + 一组采样参数，
 * 至于位图是加载来的还是画出来的，GPU 并不关心。
 */
export function createCanvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[texture] 拿不到 2D 上下文')

  draw(ctx, width, height)

  const texture = new THREE.CanvasTexture(canvas)
  // 颜色贴图要声明自己是 sRGB，否则渲染器会按线性空间解释它，画面发灰
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** 棋盘格贴图：最经典的"能一眼看出 UV 走向"的图案 */
export function createCheckerTexture(
  size = 256,
  cells = 8,
  colorA = '#e8eefc',
  colorB = '#2b3a5c',
): THREE.CanvasTexture {
  return createCanvasTexture(size, size, (ctx, w, h) => {
    const step = w / cells

    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? colorA : colorB
        ctx.fillRect(x * step, y * step, step, step)
      }
    }

    // 画一个箭头，用来确认贴图有没有被翻转 / 旋转
    ctx.fillStyle = 'rgba(255, 120, 90, 0.9)'
    ctx.beginPath()
    ctx.moveTo(w * 0.5, h * 0.18)
    ctx.lineTo(w * 0.66, h * 0.44)
    ctx.lineTo(w * 0.34, h * 0.44)
    ctx.closePath()
    ctx.fill()
  })
}

/** 竖条渐变，拿来做"假 matcap"和天空渐变都够用 */
export function createGradientTexture(colorStops: Array<[number, string]>, height = 256): THREE.CanvasTexture {
  return createCanvasTexture(4, height, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    for (const [offset, color] of colorStops) gradient.addColorStop(offset, color)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
  })
}
