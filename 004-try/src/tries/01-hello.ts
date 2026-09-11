import * as THREE from 'three'
import { mat } from '../core/kit'
import type { Try } from './types'

/**
 * 01 · 最小场
 *
 * 一个能跑的 three.js 场景需要的东西就这么点：
 *   场景（World 里的 root）+ 相机 + 渲染器（都在 core/ 里备好了）
 *   + 一个几何体 + 一个材质 + 一盏灯
 *
 * 把 build() 里除了 world.lights() 之外的几行删掉，你就得到一张白纸 ——
 * 试验场里的每个试验，都是从这里长出来的。
 */

let cube: THREE.Mesh | null = null

const params = {
  边长: 1.6,
  转速: 0.8,
  浮动: 0.35,
  颜色: '#ff8a8a',
}

export const helloTry: Try = {
  id: '01-hello',
  title: '最小场',
  summary:
    '地面 + 网格 + 一盏能投影的灯 + 一个方块。所有试验都从这个体量开始，删掉不想要的行就得到空白起点。',
  hint: '把 BoxGeometry 换成 TorusKnotGeometry(0.7, 0.22, 128, 24)；或者拉面板上的三个滑块，看方块怎么变。',
  tags: ['MeshStandardMaterial', 'DirectionalLight', '阴影', '几何体替换'],
  files: ['src/tries/01-hello.ts'],
  camera: { radius: 7.5, theta: 0.52, phi: 1.06, target: [0, 1.1, 0] },

  build({ world }) {
    world.ground(40)
    world.grid(20, 20)
    // 一行给一组"能看清东西"的光照：主光 + 补光 + 环境光
    world.lights()

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(params.边长, params.边长, params.边长), mat(params.颜色))
    mesh.position.y = 1.2
    // 有光还得让物体愿意"投"和"接"阴影，否则阴影不会出现
    mesh.castShadow = true
    mesh.receiveShadow = true
    world.add(mesh)
    cube = mesh

    const folder = world.folder('01 · 最小场')
    folder
      .add(params, '边长', 0.4, 3, 0.1)
      .name('边长')
      .onChange((size: number) => {
        // 换几何体 = 重新造一份顶点数据，旧的那份要还回显存
        mesh.geometry.dispose()
        mesh.geometry = new THREE.BoxGeometry(size, size, size)
      })
    folder.add(params, '转速', 0, 3, 0.05).name('转速')
    folder.add(params, '浮动', 0, 1, 0.02).name('上下浮动')
    folder
      .addColor(params, '颜色')
      .name('颜色')
      .onChange((hex: string) => {
        ;(mesh.material as THREE.MeshStandardMaterial).color.set(hex)
      })
  },

  update(dt, elapsed) {
    if (!cube) return
    // 动画的本质就是"每帧按当前时间重算一次"，dt 让速度与帧率无关
    cube.rotation.y += dt * params.转速
    cube.rotation.x += dt * params.转速 * 0.4
    cube.position.y = 1.2 + Math.sin(elapsed * 1.6) * params.浮动
  },

  dispose() {
    cube = null
  },
}
