import type * as THREE from 'three'
import type { PhysicsWorld } from '../core/PhysicsWorld'
import type { Stage } from '../core/Stage'
import type { CameraRig } from '../core/CameraRig'

export interface HallContext {
  stage: Stage
  scene: THREE.Scene
  physics: PhysicsWorld
  camera: CameraRig
}

export interface HallPose {
  radius: number
  theta: number
  phi: number
  target?: [number, number, number]
}

export interface Hall {
  id: string
  title: string
  /** 这个展厅在演示物理引擎的哪一项能力 */
  desc: string
  /** 用到的物理特性，显示在卡片上 */
  tags: string[]
  camera: HallPose
  /** 进入展厅（或按 R 重置）时调用，负责搭出整个场景 */
  build(ctx: HallContext): void
  /** 每帧调用，做周期行为：发射、传送、触发 */
  update?(dt: number, elapsed: number, ctx: HallContext): void
  /** 离开展厅时清理非物理资源（几何、材质、事件） */
  dispose?(ctx: HallContext): void
}
