import type * as THREE from 'three'
import type { Engine } from '../core/Engine'
import type { Orbit } from '../core/Orbit'
import type { World } from '../core/World'

/** 相机机位：球坐标（半径 / 方位角 / 俯仰角）+ 观察目标 */
export interface TryPose {
  radius: number
  theta: number
  phi: number
  target?: [number, number, number]
}

/** 每个试验拿到的运行环境 */
export interface TryContext {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  /** 相机控制器（要用相机本身就读 view.camera） */
  view: Orbit
  engine: Engine
  world: World
}

/**
 * 一个试验 = 一个文件。
 *
 * 加试验的办法：
 *   1. 在 tries/ 下新建一个 ts 文件，导出 Try；
 *   2. 去 tries/index.ts 里补一行。
 * 卡片、导航点、快捷键、面板分组都会自动跟上。
 */
export interface Try {
  /** 唯一 id，用来报错定位 */
  id: string
  title: string
  /** 这个试验在试什么（卡片上的那段说明） */
  summary: string
  /** 想动手就先改这里 —— 卡片上会高亮显示 */
  hint: string
  /** 本试验点到的 three.js 能力 */
  tags: string[]
  /** 主要源码文件，方便对照 */
  files: string[]
  /** 进入时的机位 */
  camera: TryPose
  /** 进入（或按 R 重置）时调用，负责把东西搭出来 */
  build(ctx: TryContext): void
  /** 每帧调用；dt / elapsed 是"试验时间"，已经受暂停与时间倍率影响 */
  update?(dt: number, elapsed: number, ctx: TryContext): void
  /** 离开时清理非场景图资源（事件、渲染目标……） */
  dispose?(ctx: TryContext): void
}
