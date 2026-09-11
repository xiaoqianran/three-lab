import GUI from 'lil-gui'
import * as THREE from 'three'
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import type { Engine, RenderFn } from './Engine'

export type UpdateFn = (dt: number, elapsed: number) => void
export type ResizeFn = (width: number, height: number) => void

/**
 * 世界容器 —— 章节的舞台。
 *
 * 设计要点：scene 常驻，切章时只清空 root 这一层。
 * 于是"进入一章"= 往 root 里搭东西，"离开一章"= 把 root 拆干净，
 * 章节代码永远不需要关心别的章节留下了什么。
 *
 * WebGL 的资源（几何 / 材质 / 贴图）由 GPU 持有，从场景里移除**不会**自动回收，
 * 所以 clear() 里老老实实做了一遍 traverse + dispose。
 */
export class World {
  /** 当前章节的内容层。章节里所有东西都挂在这里 */
  readonly root = new THREE.Group()
  readonly scene: THREE.Scene

  private readonly engine: Engine
  private rootFolder: GUI | null = null
  /** 不在 root 里的资源（例如 scene.background 用到的贴图）也要能一起释放 */
  private readonly tracked: THREE.Object3D[] = []
  private readonly updateFns: UpdateFn[] = []
  private readonly resizeFns: ResizeFn[] = []
  private readonly afterRenderFns: Array<() => void> = []

  constructor(scene: THREE.Scene, engine: Engine) {
    this.scene = scene
    this.engine = engine
    this.root.name = 'world'
    scene.add(this.root)

    // 转交给引擎：World 自己只是一层"按章节生命周期管理"的壳
    engine.onAfterRender(() => {
      for (const fn of this.afterRenderFns) fn()
    })
  }

  // ---------------------------------------------------------------- 搭场景

  /** 加进当前章节的内容层 */
  add<T extends THREE.Object3D>(object: T): T {
    this.root.add(object)
    return object
  }

  /** 把挂在 root 之外的对象登记进来，clear() 时会一起释放 */
  track<T extends THREE.Object3D>(object: T): T {
    this.tracked.push(object)
    return object
  }

  /** 一块地面。很多章节都要踩在地上，所以做成通用件 */
  ground(size = 80, y = 0, color = 0x1b2233): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.04 }),
    )
    // PlaneGeometry 默认立在 XY 平面，绕 X 转 -90° 才是地板
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = y
    mesh.receiveShadow = true
    return this.add(mesh)
  }

  /** 参考网格 */
  grid(size = 20, divisions = 20, y = 0.004): THREE.GridHelper {
    const helper = new THREE.GridHelper(size, divisions, 0x4a7cff, 0x22304d)
    helper.position.y = y
    // GridHelper 是"逐顶点着色"的线段，改材质透明度要注意它是共享材质
    const material = helper.material as THREE.LineBasicMaterial
    material.transparent = true
    material.opacity = 0.5
    material.depthWrite = false
    return this.add(helper)
  }

  // ---------------------------------------------------------------- 回调

  /** 每帧调用。参数是"章节时间"，已经受暂停 / 时间倍率影响 */
  onUpdate(fn: UpdateFn): void {
    this.updateFns.push(fn)
  }

  onResize(fn: ResizeFn): void {
    this.resizeFns.push(fn)
  }

  /**
   * 渲染完成之后执行。
   * 读 renderer.info 的统计（绘制批次、三角形数）必须用它 ——
   * 统计在每帧渲染前后会被清零，只有"整帧刚画完"这一刻才是完整的。
   */
  onAfterRender(fn: () => void): void {
    this.afterRenderFns.push(fn)
  }

  /** 接管渲染（第 05 章） */
  setRenderOverride(fn: RenderFn | null): void {
    this.engine.renderOverride = fn
  }

  /** 挂上后处理链（第 14 章） */
  setComposer(composer: EffectComposer | null): void {
    this.engine.composer = composer
  }

  /** 给当前章节开一个 lil-gui 分组；切章时自动销毁 */
  folder(name: string): GUI {
    if (!this.rootFolder) {
      throw new Error('[world] 还没有 attachGui，章节不能创建 GUI 分组')
    }
    return this.rootFolder.addFolder(name)
  }

  /** 主程序把 lil-gui 的根实例交给 World，章节才能往面板上挂控件 */
  attachGui(gui: GUI): void {
    this.rootFolder = gui.addFolder('本章')
    this.rootFolder.domElement.classList.add('world-folder')
  }

  /** 章节专属参数列表，显示在面板"本章"分组里 */
  chapterParams(params: Record<string, unknown>): GUI {
    const folder = this.folder('参数')
    for (const key of Object.keys(params)) {
      const value = params[key]
      if (typeof value === 'boolean') folder.add(params, key).name(key)
      else if (typeof value === 'number') folder.add(params, key).name(key)
    }
    return folder
  }

  // ---------------------------------------------------------------- 每帧

  update(dt: number, elapsed: number): void {
    for (const fn of this.updateFns) fn(dt, elapsed)
  }

  resize(width: number, height: number): void {
    for (const fn of this.resizeFns) fn(width, height)
  }

  // ---------------------------------------------------------------- 拆卸

  /** 拆掉当前章节：还原引擎状态、释放显存、清空回调与面板 */
  clear(): void {
    // 1. 撤销章节对引擎做过的临时改动
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

  /** 递归释放一棵子树上的几何 / 材质 / 贴图 */
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
        // 材质引用的贴图（map / normalMap / envMap ...）同样是显存资源
        for (const value of Object.values(item)) {
          const texture = value as THREE.Texture | null
          if (texture && texture.isTexture) texture.dispose()
        }
        item.dispose()
      }
    })
  }
}
