import GUI from 'lil-gui'
import * as THREE from 'three'
import type { Engine } from './Engine'

export type UpdateFn = (dt: number, elapsed: number) => void
export type ResizeFn = (width: number, height: number) => void

export interface LightOptions {
  /** 主光强度，也就是投影的那盏 */
  key?: number
  /** 补光强度，用来把背光面提起来 */
  fill?: number
  /** 环境光强度 */
  ambient?: number
  /** 主光位置 */
  keyPosition?: [number, number, number]
}

/**
 * 试验场。
 *
 * 和 003 的 World 相比，这里更"顺手"：地面、网格、光照都是一行搞定，
 * 目的是让一个试验的 build() 尽量短 —— 短才好改。
 *
 * 资源释放仍然是硬要求：几何 / 材质 / 贴图都占显存，
 * 从场景里移除不等于还回去，clear() 里老老实实 traverse + dispose。
 */
export class World {
  readonly root = new THREE.Group()
  readonly scene: THREE.Scene

  private readonly engine: Engine
  private rootFolder: GUI | null = null
  private readonly tracked: THREE.Object3D[] = []
  private readonly updateFns: UpdateFn[] = []
  private readonly resizeFns: ResizeFn[] = []
  private readonly afterRenderFns: Array<() => void> = []

  constructor(scene: THREE.Scene, engine: Engine) {
    this.scene = scene
    this.engine = engine
    this.root.name = 'try'
    scene.add(this.root)

    engine.onAfterRender(() => {
      for (const fn of this.afterRenderFns) fn()
    })
  }

  // ---------------------------------------------------------------- 放东西

  add<T extends THREE.Object3D>(object: T): T {
    this.root.add(object)
    return object
  }

  /** 挂到 root 之外的对象（背景、辅助器……）登记进来，clear() 时会一起释放 */
  track<T extends THREE.Object3D>(object: T): T {
    this.tracked.push(object)
    return object
  }

  /**
   * 从场景里拿走一个对象，并把它带的几何 / 材质 / 贴图还回显存。
   * 只说 remove() 是不够的 —— GPU 上的那份数据不会自己消失。
   */
  remove(object: THREE.Object3D): void {
    object.removeFromParent()
    this.disposeObject(object)
  }

  /** 一块能接阴影的地面，一行搞定 */
  ground(size = 60, color = 0x1e2436): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 }),
    )
    // PlaneGeometry 默认立在 XY 平面，绕 X 转 -90° 才是地板
    mesh.rotation.x = -Math.PI / 2
    mesh.receiveShadow = true
    return this.add(mesh)
  }

  grid(size = 30, divisions = 30, y = 0.004): THREE.GridHelper {
    const helper = new THREE.GridHelper(size, divisions, 0x4a7cff, 0x22304d)
    helper.position.y = y
    const material = helper.material as THREE.LineBasicMaterial
    material.transparent = true
    material.opacity = 0.45
    material.depthWrite = false
    return this.add(helper)
  }

  /**
   * 一行给一组"能看清东西"的光照：
   * 主光（投影）+ 补光 + 环境光。要自己精细调光时就不用它。
   */
  lights(options: LightOptions = {}): {
    key: THREE.DirectionalLight
    fill: THREE.DirectionalLight
    ambient: THREE.AmbientLight
  } {
    // 强度别给太大：光照一强，材质颜色会整体冲淡成"粉彩"，
    // 想看清颜色本身（尤其是这一版试验场里的小物体）宁可暗一点
    const { key = 1.8, fill = 0.45, ambient = 0.6, keyPosition = [8, 13, 9] } = options

    const keyLight = new THREE.DirectionalLight(0xfff3e2, key)
    keyLight.position.set(keyPosition[0], keyPosition[1], keyPosition[2])
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(2048, 2048)
    // 阴影相机是正交相机，范围刚好罩住场景就行：太大每像素覆盖的面积就大，阴影会糊
    keyLight.shadow.camera.left = -20
    keyLight.shadow.camera.right = 20
    keyLight.shadow.camera.top = 20
    keyLight.shadow.camera.bottom = -20
    keyLight.shadow.camera.far = 60
    keyLight.shadow.bias = -0.0009
    keyLight.shadow.normalBias = 0.03
    keyLight.shadow.camera.updateProjectionMatrix()

    const fillLight = new THREE.DirectionalLight(0x7f9bff, fill)
    fillLight.position.set(-9, 6, -8)

    const ambientLight = new THREE.AmbientLight(0x8fa3cc, ambient)

    this.scene.add(keyLight, fillLight, ambientLight)
    // 灯光挂在 scene 上而不是 root 上，所以登记一下让 clear() 也能收走它们
    this.tracked.push(keyLight, fillLight, ambientLight)
    return { key: keyLight, fill: fillLight, ambient: ambientLight }
  }

  // ---------------------------------------------------------------- 回调

  onUpdate(fn: UpdateFn): void {
    this.updateFns.push(fn)
  }

  onResize(fn: ResizeFn): void {
    this.resizeFns.push(fn)
  }

  onAfterRender(fn: () => void): void {
    this.afterRenderFns.push(fn)
  }

  /** 接管渲染（做分屏、镜面这类需要多次渲染的试验时用） */
  setRenderOverride(fn: ((dt: number) => void) | null): void {
    this.engine.renderOverride = fn
  }

  // ---------------------------------------------------------------- 面板

  /** 给当前试验开一个 lil-gui 分组；切试验时自动销毁 */
  folder(name: string): GUI {
    if (!this.rootFolder) throw new Error('[world] 还没有 attachGui，试验不能创建 GUI 分组')
    return this.rootFolder.addFolder(name)
  }

  /** 主程序把 lil-gui 根实例交给 World，试验才能往面板上挂控件 */
  attachGui(gui: GUI): void {
    this.rootFolder = gui.addFolder('本试验')
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number, elapsed: number): void {
    for (const fn of this.updateFns) fn(dt, elapsed)
  }

  resize(width: number, height: number): void {
    for (const fn of this.resizeFns) fn(width, height)
  }

  // ---------------------------------------------------------------- 拆卸

  clear(): void {
    // 1. 还原试验对引擎做过的临时改动
    this.engine.renderOverride = null
    this.engine.composer = null
    this.engine.resetSceneState()

    // 2. 释放显存
    for (const object of [...this.root.children, ...this.tracked]) this.disposeObject(object)
    this.root.clear()
    this.tracked.length = 0

    // 3. 清空回调与面板
    this.updateFns.length = 0
    this.resizeFns.length = 0
    this.afterRenderFns.length = 0
    this.rootFolder?.destroy()
    this.rootFolder = null
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const resource = child as THREE.Object3D & {
        geometry?: THREE.BufferGeometry
        material?: THREE.Material | THREE.Material[]
      }

      resource.geometry?.dispose()

      const material = resource.material
      if (!material) return

      for (const item of Array.isArray(material) ? material : [material]) {
        // 材质上挂的贴图也是显存资源
        for (const value of Object.values(item)) {
          const texture = value as THREE.Texture | null
          if (texture && texture.isTexture) texture.dispose()
        }
        item.dispose()
      }
    })
  }
}
