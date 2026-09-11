import type * as THREE from 'three'
import type { CameraRig } from '../core/CameraRig'
import type { Engine } from '../core/Engine'
import type { World } from '../core/World'

/** 相机机位：球坐标（半径 / 方位角 / 俯仰角）+ 观察目标 */
export interface ChapterPose {
  radius: number
  theta: number
  phi: number
  target?: [number, number, number]
}

/** 每一章拿到的运行环境。章节之间不互相 import，只通过它交流 */
export interface ChapterContext {
  /** 场景根节点 */
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  /** 轨道相机 */
  camera: CameraRig
  engine: Engine
  world: World
}

/**
 * 一章 = 一个文件。
 *
 * 想加新章节，只要在 chapters/ 下新建一个 ts 文件导出 Chapter，
 * 再去 chapters/index.ts 里补一行 —— 卡片、导航、快捷键、源码阅读器全都会自动跟上。
 */
export interface Chapter {
  /** 唯一 id，同时用来报错定位 */
  id: string
  /** 卡片标题 */
  title: string
  /** 这一步在世界里加了什么 —— 卡片上的那段说明 */
  summary: string
  /** 本步点亮的 three.js 能力，作为标签展示 */
  apis: string[]
  /** 本步的主源码，卡片上点击即可对照阅读 */
  files: string[]
  /** 进入这一章时的机位 */
  camera: ChapterPose
  /** 进入这一章（或按 R 重置）时调用，负责把东西搭出来 */
  build(ctx: ChapterContext): void
  /**
   * 每帧调用。
   * dt / elapsed 是"章节时间"，已经受暂停与时间倍率影响；
   * 相机阻尼之类跟时间无关的动作放在 main 里推进。
   */
  update?(dt: number, elapsed: number, ctx: ChapterContext): void
  /** 离开这一章时清理非场景图资源（渲染目标、事件、观察者……） */
  dispose?(ctx: ChapterContext): void
}
