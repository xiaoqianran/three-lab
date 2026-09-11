import * as THREE from 'three'
import { createLabel } from '../core/Label'
import { createCanvasTexture, createCheckerTexture } from '../core/texture'
import type { Chapter } from './types'

/**
 * 06 · 纹理与 UV
 *
 * 纹理解决"表面细节"的问题。要理解三件事：
 *
 * 1. 贴图是怎么贴上去的？靠 UV 坐标 —— 几何体的每个顶点除了 position，
 *    还带一组 uv（0~1 的二维坐标），片元着色器拿它去采样纹理。
 *    同一个几何体换 UV，贴图就会错位、翻转、拉伸。
 *
 * 2. 采样参数决定"超出 UV 范围怎么办、放大缩小怎么插值"：
 *    wrapS / wrapT（重复 / 夹边 / 镜像）、magFilter / minFilter、
 *    repeat / offset / rotation / center、anisotropy。
 *
 * 3. colorSpace 必须写对：颜色贴图要设成 SRGBColorSpace。
 *    不设的话渲染器会把它当线性数据，画面立刻发灰 —— 这是新手最常踩的坑。
 *
 * 本章所有贴图都是**现场用 canvas 画出来的**，不需要任何素材文件。
 */

let checkerTexture: THREE.CanvasTexture | null = null
let dataTexture: THREE.DataTexture | null = null
let loadedTexture: THREE.Texture | null = null
let spinCube: THREE.Mesh | null = null

export const textures: Chapter = {
  id: '06-textures',
  title: '纹理与 UV',
  summary:
    '同一张棋盘格贴到平面、球体、立方体上，看 UV 是怎么把二维图像"包"到三维表面上的。再用 DataTexture 直接喂像素数组做一张像素画，用 TextureLoader 走一遍真实的异步加载流程（LoadingManager 的进度会显示在面板上）。',
  apis: [
    'TextureLoader', 'CanvasTexture', 'DataTexture', 'LoadingManager', 'RepeatWrapping',
    'MirroredRepeatWrapping', 'ClampToEdgeWrapping', 'magFilter / minFilter', 'anisotropy',
    'repeat / offset / rotation', 'SRGBColorSpace', 'texture array',
  ],
  files: ['src/chapters/06-textures.ts', 'src/core/texture.ts', 'src/core/Label.ts'],
  camera: { radius: 15, theta: 0.42, phi: 1.08, target: [0, 1.8, 0] },

  build({ world, scene }) {
    world.ground(60)
    world.grid(24, 24)

    const light = new THREE.DirectionalLight(0xffffff, 2.4)
    light.position.set(6, 10, 8)
    scene.add(light)
    scene.add(new THREE.AmbientLight(0x8fa3cc, 1.4))

    // ---- 1. 棋盘格：最经典的"能看出 UV 走向"的贴图 ----
    checkerTexture = createCheckerTexture(256, 8)
    // 贴图在 UV 范围外怎么取？RepeatWrapping = 平铺重复
    checkerTexture.wrapS = THREE.RepeatWrapping
    checkerTexture.wrapT = THREE.RepeatWrapping
    // 斜着看平面时，各向异性过滤能让远处的格子不糊成一片
    checkerTexture.anisotropy = 8
    checkerTexture.repeat.set(1, 1)

    const checkerMaterial = new THREE.MeshStandardMaterial({ map: checkerTexture, roughness: 0.6 })

    // 平面、球体、立方体各一块 —— 对比同一张图在不同 UV 布局下的效果
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), checkerMaterial)
    plane.position.set(-5.4, 2.1, 0)
    world.add(plane)

    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.9, 48, 32), checkerMaterial)
    sphere.position.set(0, 2, 0)
    sphere.castShadow = true
    world.add(sphere)

    // 立方体用 6 张不同的贴图：几何体的 group 顺序是 +X -X +Y -Y +Z -Z，
    // 材质数组按同样的顺序对应六个面
    const faceColors = ['#ff8a8a', '#ffc97a', '#ffe98a', '#8ae9c0', '#8ad4ff', '#b08aff']
    const cubeMaterials = faceColors.map((color) =>
      new THREE.MeshStandardMaterial({
        map: createCanvasTexture(128, 128, (ctx, size) => {
          ctx.fillStyle = color
          ctx.fillRect(0, 0, size, size)
          ctx.fillStyle = 'rgba(8, 11, 20, 0.72)'
          ctx.font = '600 44px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(color, size / 2, size / 2)
        }),
        roughness: 0.55,
      }),
    )
    const cube = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), cubeMaterials)
    cube.position.set(5.4, 2.1, 0)
    cube.castShadow = true
    world.add(cube)

    // ---- 2. DataTexture：直接给像素数组 ----
    // 这是"纹理最底层的样子"：一块 RGBA 内存。
    // 注意每个通道都是 0~255 的整数，比 canvas 更接近 GPU 实际拿到的数据
    const size = 32
    const data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4
        const block = ((x >> 2) + (y >> 2)) % 2 === 0
        data[offset] = block ? 255 : 40
        data[offset + 1] = (x / (size - 1)) * 255
        data[offset + 2] = (y / (size - 1)) * 255
        data[offset + 3] = 255
      }
    }

    dataTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    // 手写的像素数据，颜色空间要自己声明
    dataTexture.colorSpace = THREE.SRGBColorSpace
    // NearestFilter = 放大时不做插值，保留硬边像素块（像素风游戏必备）
    dataTexture.magFilter = THREE.NearestFilter
    dataTexture.minFilter = THREE.NearestFilter
    dataTexture.needsUpdate = true

    const pixelPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ map: dataTexture }),
    )
    pixelPlane.position.set(-5.4, 2.2, 5.4)
    world.add(pixelPlane)

    const pixelLabel = createLabel('DataTexture', { size: 0.3 })
    pixelLabel.position.set(-5.4, 4.4, 5.4)
    world.add(pixelLabel)

    // ---- 3. TextureLoader：真正的异步加载 ----
    // 这里用 canvas.toDataURL() 造一个"图片地址"，加载流程与加载一张 png 完全一样，
    // 真实项目里把 url 换成 '/textures/wall.jpg' 就行
    const manager = new THREE.LoadingManager()
    const loader = new THREE.TextureLoader(manager)

    const asyncPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 }),
    )
    asyncPlane.position.set(5.4, 2.2, 5.4)
    world.add(asyncPlane)

    const asyncLabel = createLabel('TextureLoader', { size: 0.3 })
    asyncLabel.position.set(5.4, 4.4, 5.4)
    world.add(asyncLabel)

    const params = {
      重复次数: 1,
      offsetX: 0,
      offsetY: 0,
      旋转: 0,
      各向异性: 8,
      采样: '线性',
      环绕: '重复',
      加载状态: '等待中…',
    }

    const folder = world.folder('第 06 章')
    const stateController = folder.add(params, '加载状态').disable()

    manager.onStart = (url) => {
      params.加载状态 = '开始加载…'
      void url
      stateController.updateDisplay()
    }
    manager.onProgress = (url, loaded, total) => {
      params.加载状态 = `加载中 ${loaded}/${total}`
      void url
      stateController.updateDisplay()
    }
    manager.onLoad = () => {
      params.加载状态 = '全部加载完成'
      stateController.updateDisplay()
    }

    // 用刚画好的棋盘格导出成 dataURL 当作"外部图片"
    const imageUrl = (checkerTexture.image as HTMLCanvasElement).toDataURL()
    loader.load(imageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 8
      loadedTexture = texture
      const material = asyncPlane.material as THREE.MeshStandardMaterial
      material.map = texture
      // 给材质加贴图后要让它重新编译
      material.needsUpdate = true
    })

    // ---- 贴图参数实时调节 ----
    const applyTransform = (): void => {
      if (!checkerTexture) return
      checkerTexture.repeat.set(params.重复次数, params.重复次数)
      checkerTexture.offset.set(params.offsetX, params.offsetY)
      checkerTexture.rotation = THREE.MathUtils.degToRad(params.旋转)
      checkerTexture.center.set(0.5, 0.5)
      checkerTexture.anisotropy = params.各向异性
    }

    folder.add(params, '重复次数', 1, 6, 1).name('平铺次数').onChange(applyTransform)
    folder.add(params, 'offsetX', 0, 1, 0.01).name('U 偏移').onChange(applyTransform)
    folder.add(params, 'offsetY', 0, 1, 0.01).name('V 偏移').onChange(applyTransform)
    folder.add(params, '旋转', 0, 180, 1).name('旋转角度').onChange(applyTransform)
    folder.add(params, '各向异性', 1, 16, 1).name('各向异性').onChange(applyTransform)
    folder
      .add(params, '环绕', ['重复', '镜像重复', '夹边'])
      .name('环绕方式 wrap')
      .onChange((value: string) => {
        if (!checkerTexture) return
        const mode =
          value === '镜像重复'
            ? THREE.MirroredRepeatWrapping
            : value === '夹边'
              ? THREE.ClampToEdgeWrapping
              : THREE.RepeatWrapping
        checkerTexture.wrapS = mode
        checkerTexture.wrapT = mode
        // 换了环绕方式要重新上传贴图
        checkerTexture.needsUpdate = true
      })
    folder
      .add(params, '采样', ['线性', '最近点'])
      .name('放大采样 magFilter')
      .onChange((value: string) => {
        if (!dataTexture) return
        dataTexture.magFilter = value === '最近点' ? THREE.NearestFilter : THREE.LinearFilter
        dataTexture.needsUpdate = true
      })

    spinCube = cube
  },

  update(dt) {
    // 立方体自转：能看到六个面各自贴着不同的贴图
    if (spinCube) spinCube.rotation.y += dt * 0.3
  },

  dispose() {
    // 这些贴图是"按需创建"的，虽然 World 会释放场景里引用到的贴图，
    // 但像 dataTexture 这种只挂在材质上的，自己再收一次尾更踏实
    checkerTexture = null
    dataTexture = null
    loadedTexture = null
    spinCube = null
  },
}
