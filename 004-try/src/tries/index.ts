import type { Try } from './types'
import { helloTry } from './01-hello'
import { scatterTry } from './02-scatter'
import { terrainTry } from './03-noise-terrain'
import { easingTry } from './04-easing'

/**
 * 试验注册表 —— 这就是试验场的全部内容。
 *
 * 加一个试验：
 *   1. 在 tries/ 下新建一个 ts 文件，导出一个 Try（照着 01-hello.ts 抄最快）；
 *   2. 在下面数组里补一行。
 * 卡片、导航点、快捷键、面板分组都会自动跟上。
 *
 * 现在这 4 个的作用是"演示怎么加" —— 想从零开始，把不想要的删掉就行。
 * 每个试验都是自成一体的：删掉它不会影响别人。
 */
export const TRIES: Try[] = [helloTry, scatterTry, terrainTry, easingTry]
