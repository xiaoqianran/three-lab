import * as THREE from 'three'
import type { Chapter } from './types'

/**
 * 05 · 相机与投影
 *
 * 相机决定"看到什么"，而投影方式决定"怎么看"：
 *   PerspectiveCamera   透视相机 —— 有近大远小，fov 越大越像广角镜头
 *   OrthographicCamera  正交相机 —— 没有透视，多远的物体都是同样大小（工程图 / 2D 游戏用它）
 *
 * 这一章左右分屏，两台相机看同一个场景，差别一眼就能看出来。
 * 分屏的做法值得记一下：WebGL 的视口（viewport）和裁剪区（scissor）都是可以设置的，
 * 设好之后连续 render 两次，就得到两个独立的画面。
 */

let perspCamera: THREE.PerspectiveCamera | null = null
let orthoCamera: THREE.OrthographicCamera | null = null
let overlay: HTMLDivElement | null = null
let perspHelper: THREE.CameraHelper | null = null
let orthoHelper: THREE.CameraHelper | null = null

export const cameras: Chapter = {
  id: '05-cameras',
  title: '相机与投影',
  summary:
    '左边透视、右边正交，同一个场景两种投影。透视相机的 fov 相当于镜头焦距，改大一点就能看到明显的畸变；两者视野要对齐，就得按"距离 × tan(fov/2)"反算正交相机的上下边界 —— 这道换算题是理解投影矩阵最快的方式。面板里可以打开两台相机的视锥线框，看清"金字塔"和"长方体"的形状差别。',
  apis: [
    'PerspectiveCamera', 'OrthographicCamera', 'fov', 'aspect', 'near / far',
    'CameraHelper', 'setViewport', 'setScissor', 'updateProjectionMatrix',
  ],
  files: ['src/chapters/05-cameras.ts', 'src/core/CameraRig.ts'],
  camera: { radius: 30, theta: 0.14, phi: 1.2, target: [0, 2, -10] },

  build({ world, scene, renderer, camera }) {
    world.ground(120)
    world.grid(60, 60)

    // ---- 布景：一排等距的方块沿 -Z 排开 ----
    // 透视看过去"近大远小"，正交看过去"一样大"，这是两种投影最直观的区别
    const boxGeometry = new THREE.BoxGeometry(2.4, 2.4, 2.4)
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x9fb4ff, roughness: 0.5, metalness: 0.15 })
    for (let i = 0; i < 12; i++) {
      const box = new THREE.Mesh(boxGeometry, boxMaterial)
      box.position.set(-7 + (i % 3) * 7, 1.2, -2 - i * 4)
      box.castShadow = true
      box.receiveShadow = true
      world.add(box)
    }

    // 再加几个球，方便对比"同样大小的远处的球"
    const sphereGeometry = new THREE.SphereGeometry(1, 24, 16)
    const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0xffc98a, roughness: 0.35, metalness: 0.1 })
    for (let i = 0; i < 5; i++) {
      const ball = new THREE.Mesh(sphereGeometry, sphereMaterial)
      ball.position.set(3.2, 1, -6 - i * 6)
      ball.castShadow = true
      world.add(ball)
    }

    const light = new THREE.DirectionalLight(0xffffff, 2.6)
    light.position.set(10, 14, 6)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.camera.left = -25
    light.shadow.camera.right = 25
    light.shadow.camera.top = 25
    light.shadow.camera.bottom = -25
    light.shadow.camera.far = 60
    light.shadow.camera.updateProjectionMatrix()
    scene.add(light)
    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2b3550, 0.9))

    // ---- 两台相机 ----
    // 左半边直接用主相机（可以拖拽），右半边新建一台正交相机跟着它
    perspCamera = camera.camera
    orthoCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400)

    // CameraHelper 会把视锥画出来：透视是"金字塔"，正交是"长方体"。
    // 默认关掉 —— 视锥的锥尖就在相机自己身上，全画出来会糊满整个屏幕，
    // 想看的时候在面板里打开就行
    perspHelper = new THREE.CameraHelper(perspCamera)
    orthoHelper = new THREE.CameraHelper(orthoCamera)
    perspHelper.visible = false
    orthoHelper.visible = false
    scene.add(perspHelper, orthoHelper)

    // ---- 分屏渲染：接管 renderer，连续画两次 ----
    world.setRenderOverride(() => {
      const width = window.innerWidth
      const height = window.innerHeight
      const half = Math.floor(width / 2)

      // 视口 = 画到哪里；裁剪区 = 允许修改哪一块（清屏也会被它限制）
      renderer.setScissorTest(true)

      renderer.setViewport(0, 0, half, height)
      renderer.setScissor(0, 0, half, height)
      renderer.render(scene, perspCamera!)

      renderer.setViewport(half, 0, width - half, height)
      renderer.setScissor(half, 0, width - half, height)
      renderer.render(scene, orthoCamera!)
    })

    // ---- 屏幕上的说明（DOM 覆盖层也跟着相机一起做） ----
    overlay = document.createElement('div')
    overlay.className = 'split-hint'
    overlay.innerHTML =
      '<i></i><span>透视 · PerspectiveCamera</span><span>正交 · OrthographicCamera</span>'
    document.body.appendChild(overlay)

    // ---- 本章参数 ----
    const folder = world.folder('第 05 章')
    folder
      .add(perspCamera, 'fov', 12, 120, 1)
      .name('透视 fov')
      .onChange(() => {
        perspCamera?.updateProjectionMatrix()
        perspHelper?.update()
      })
    folder.add(perspCamera, 'near', 0.1, 12, 0.1).name('near').onChange(() => perspHelper?.update())
    folder.add(perspCamera, 'far', 60, 600, 10).name('far').onChange(() => perspHelper?.update())
    folder.add(perspHelper, 'visible').name('显示透视视锥')
    folder.add(orthoHelper, 'visible').name('显示正交视锥')
    folder
      .add({ 同步: true }, '同步')
      .name('正交随透视同步缩放')
      .onChange((v: boolean) => {
        followPerspective = v
      })
  },

  update(_dt, _elapsed, { camera }) {
    if (!perspCamera || !orthoCamera) return

    // 正交相机怎么"跟"着透视相机？
    // 先把位置和朝向抄过来，再按"同样的视野范围"反算上下边界：
    //   半高 = 距离 × tan(fov / 2)
    // 这样两台相机在同一位置看到的世界范围是一样的，对比才有意义
    orthoCamera.position.copy(perspCamera.position)
    orthoCamera.quaternion.copy(perspCamera.quaternion)

    if (followPerspective) {
      const distance = perspCamera.position.distanceTo(camera.lookAt)
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(perspCamera.fov / 2)) * Math.max(distance, 1)
      // 右半屏的宽高比是整个窗口的一半，所以宽度要按半屏算
      const viewportAspect = window.innerWidth / 2 / window.innerHeight
      const halfWidth = halfHeight * viewportAspect

      orthoCamera.left = -halfWidth
      orthoCamera.right = halfWidth
      orthoCamera.top = halfHeight
      orthoCamera.bottom = -halfHeight
      orthoCamera.updateProjectionMatrix()
      orthoHelper?.update()
    }
  },

  dispose() {
    // 覆盖层是 DOM，不在场景图里，World 管不到它 —— 必须自己收尾
    overlay?.remove()
    overlay = null
    perspHelper = null
    orthoHelper = null
    orthoCamera = null
    perspCamera = null
  },
}

let followPerspective = true
