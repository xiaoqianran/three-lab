import type { Chapter } from './types'
import { emptyWorld } from './01-empty-world'
import { primitives } from './02-primitives'
import { materials } from './03-materials'
import { lights } from './04-lights'
import { cameras } from './05-cameras'
import { textures } from './06-textures'
import { hierarchy } from './07-hierarchy'
import { curves } from './08-curves'
import { animation } from './09-animation'
import { instancing } from './10-instancing'
import { shaders } from './11-shaders'
import { rigging } from './12-rigging'
import { picking } from './13-picking'
import { postfx } from './14-postfx'
import { environment } from './15-environment'
import { serialization } from './16-serialization'
import { performance } from './17-performance'

/**
 * 章节注册表 —— 这就是「从零构建世界」的全部内容。
 *
 * 想加一章，只要在 chapters/ 下新建一个 ts 文件导出 Chapter，
 * 再在下面补一行：卡片、导航点、快捷键、源码阅读器都会自动跟上。
 *
 * 四个批次大致对应四类问题：
 *   批次 A · 骨架        空场景 / 几何 / 材质 / 光照
 *   批次 B · 空间        相机 / 贴图 / 层级 / 曲线
 *   批次 C · 时间与数量  动画 / 实例化 / 着色器 / 骨骼
 *   批次 D · 交互与氛围  拾取 / 后处理 / 环境 / 序列化 / 性能
 */
export const CHAPTERS: Chapter[] = [
  // 批次 A · 骨架
  emptyWorld,
  primitives,
  materials,
  lights,
  // 批次 B · 空间
  cameras,
  textures,
  hierarchy,
  curves,
  // 批次 C · 时间与数量
  animation,
  instancing,
  shaders,
  rigging,
  // 批次 D · 交互与氛围
  picking,
  postfx,
  environment,
  serialization,
  performance,
]
