import type { Hall } from './types'
import { shapesHall } from './01-shapes'
import { stackHall } from './02-stack'
import { dominoesHall } from './03-dominoes'
import { terrainHall } from './04-terrain'
import { jointsHall } from './05-joints'
import { ragdollHall } from './06-ragdoll'
import { machineHall } from './07-machines'
import { ropeHall } from './08-rope'
import { springHall } from './09-spring'
import { newtonHall } from './10-newton'
import { ccdHall } from './11-ccd'
import { sensorHall } from './12-sensors'
import { kinematicHall } from './13-kinematic'
import { swarmHall } from './14-swarm'
import { destructionHall } from './15-destruction'
import { clothHall } from './16-cloth'
import { vehicleHall } from './17-vehicle'

/**
 * 展厅注册表 —— 这就是"物理博物馆"的全部内容。
 * 加新展厅只要在这里补一行：步骤条、说明卡片、键盘切换全都会自动跟上。
 */
export const HALLS: Hall[] = [
  // 批次 A · 形状与地形
  shapesHall,
  stackHall,
  dominoesHall,
  terrainHall,
  // 批次 B · 关节与机构
  jointsHall,
  ragdollHall,
  machineHall,
  ropeHall,
  springHall,
  // 批次 C · 动力学特性
  newtonHall,
  ccdHall,
  sensorHall,
  kinematicHall,
  // 批次 D · 数量与破坏
  swarmHall,
  destructionHall,
  clothHall,
  vehicleHall,
]
