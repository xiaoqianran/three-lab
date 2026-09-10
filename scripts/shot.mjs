/**
 * 用 headless Chrome 连续给多个展厅截图，并回传控制台错误。
 *
 *   node scripts/shot.mjs <url> <输出前缀> [首次等待ms] [拍几个展厅] [每个展厅等待ms]
 *
 * WebGL 走软件光栅（swiftshader），慢但能真实反映渲染结果。
 */
import puppeteer from 'puppeteer'

const url = process.argv[2] ?? 'http://localhost:5273/'
const prefix = process.argv[3] ?? '/tmp/hall'
const wait = Number(process.argv[4] ?? 9000)
const count = Number(process.argv[5] ?? 1)
const perHall = Number(process.argv[6] ?? 4200)

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-dev-shm-usage',
    '--window-size=1440,810',
  ],
  defaultViewport: { width: 1440, height: 810 },
})

const page = await browser.newPage()

const logs = []
page.on('console', (msg) => {
  const type = msg.type()
  if (type === 'error') logs.push(`[error] ${msg.text()}`)
})
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, wait))

  for (let i = 0; i < count; i++) {
    const path = `${prefix}-${String(i + 1).padStart(2, '0')}.png`
    await page.screenshot({ path })

    const stats = await page.evaluate(() => {
      const get = (id) => document.getElementById(id)?.textContent ?? '?'
      const museum = window.__museum
      const b = museum?.stage?.getBounds?.()

      return {
        hall: get('hall-no'),
        title: get('hall-title'),
        fps: get('fps'),
        bodies: get('bodies'),
        draws: get('drawcalls'),
        // 场景实际包围盒：y 的范围能直接看出东西是站着还是塌了
        y: b ? `${b.minY.toFixed(1)}..${b.maxY.toFixed(1)}` : '?',
        x: b ? `${b.minX.toFixed(1)}..${b.maxX.toFixed(1)}` : '?',
        z: b ? `${b.minZ.toFixed(1)}..${b.maxZ.toFixed(1)}` : '?',
        fastest: (museum?.stage?.getFastest?.(3) ?? [])
          .map(
            (f) =>
              `v=${f.speed.toFixed(1)}@(${f.x.toFixed(0)},${f.y.toFixed(0)},${f.z.toFixed(0)})e${f.edge.toFixed(2)}m${(f.mass ?? 0).toFixed(2)}`,
          )
          .join(' | '),
      }
    })

    console.log(`${path}  ${JSON.stringify(stats)}`)

    if (i < count - 1) {
      await page.keyboard.press('ArrowRight')
      await new Promise((r) => setTimeout(r, perHall))
    }
  }
} catch (error) {
  console.log('FAILED:', error.message)
}

console.log('--- console ---')
console.log(logs.length ? logs.slice(0, 20).join('\n') : '(clean)')

await browser.close()
