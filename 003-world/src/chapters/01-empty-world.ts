import * as THREE from 'three'
import type { Chapter } from './types'

/**
 * 01 · 最小可运行世界
 *
 * 一个能跑的 three.js 程序只有三件事：
 *   Scene（场景）    —— 一棵装东西的树
 *   Camera（相机）   —— 从哪里看
 *   Renderer（渲染器）—— 把前两者画成像素
 * （这三样已经由 core/Engine.ts 装配好了，本章只管往场景里放东西）
 *
 * 这一章刻意不引入任何光照、贴图、模型，只用最原始的"三个顶点"拼一个三角形，
 * 目的是先建立两个认知：
 *   1. 几何体的本质就是一组顶点属性（position / color / uv ...），
 *      至于它们组成什么形状，由 three 的绘制规则决定；
 *   2. 缺省情况下"一个三角形每 3 个顶点连成一个面"，这就是最简单的几何体。
 */

// 模块级变量：章节内部的状态就放在这里，跟函数的生命周期解耦
let triangle: THREE.Mesh
let vertexDots: THREE.Points

export const emptyWorld: Chapter = {
  id: '01-empty-world',
  title: '最小可运行世界',
  summary:
    '先立一把尺子：坐标轴 + 参考网格。然后手搓一个只有三个顶点的三角形 —— 它在 three.js 里已经算一个完整的"几何体"了。把相机、渲染循环、每帧更新这几件事串起来，后面每一章都是在这块地基上继续加东西。',
  apis: ['Scene', 'PerspectiveCamera', 'WebGLRenderer', 'BufferGeometry', 'BufferAttribute', 'Mesh', 'Points'],
  files: ['src/chapters/01-empty-world.ts', 'src/core/Engine.ts'],
  camera: { radius: 7.5, theta: 0.7, phi: 1.02, target: [0, 0.7, 0] },

  build({ world }) {
    // ---- 1. 尺子：坐标轴与网格 ----
    // AxesHelper：红 = +X，绿 = +Y，蓝 = +Z。记住这三个方向，后面调位置全靠它
    world.add(new THREE.AxesHelper(2.2))
    // GridHelper(size, divisions)：20 米见方、每格 1 米的参考网格
    world.grid(20, 20)

    // ---- 2. 手搓几何体 ----
    // BufferGeometry 是所有内置几何体的底层形态：它只存"顶点属性数组"，
    // 不存"三角形"这种概念（除了可选的 index 索引）。
    const geometry = new THREE.BufferGeometry()

    // 三个顶点，每个顶点 (x, y, z)，共 3×3 个浮点数
    const positions = new Float32Array([
      -1, 0, 0,
      1, 0, 0,
      0, 1.6, 0,
    ])

    // 每个顶点再配一个 RGB 颜色（0~1），配合 material.vertexColors 用
    const colors = new Float32Array([
      1.0, 0.33, 0.42,
      0.3, 0.78, 1.0,
      1.0, 0.86, 0.4,
    ])

    // setAttribute 的第二个参数是"一个顶点占几个分量"，位置是 3（x/y/z），颜色也是 3
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    // 没有 index 时，顶点 0-1-2 自动组成一个三角形；顶点顺序决定正面朝向

    // ---- 3. 材质与网格 ----
    const material = new THREE.MeshBasicMaterial({
      // MeshBasicMaterial 是唯一"不需要光照"的网格材质：颜色直接就是屏幕上的颜色
      vertexColors: true,
      // 默认只画正面，视线绕到背面就什么也看不见，这里两面都画
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
    })

    triangle = new THREE.Mesh(geometry, material)
    triangle.position.y = 0.3
    world.add(triangle)

    // ---- 4. 顶点点云 ----
    // 同一个 geometry 可以喂给不同的对象：这里用 Points 把三个顶点标出来
    vertexDots = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.14,
        vertexColors: true,
        // sizeAttenuation：远处的点自动变小，否则点云会像一片贴纸
        sizeAttenuation: true,
      }),
    )
    vertexDots.position.copy(triangle.position)
    world.add(vertexDots)

    // ---- 5. 本章参数 ----
    // world.folder() 会在控制面板里开一个"本章"分组，切章时自动销毁
    const params = { 自转速度: 0.7, 显示三个顶点: true }
    const folder = world.folder('第 01 章')
    folder.add(params, '自转速度', 0, 3, 0.01).name('自转速度')
    folder
      .add(params, '显示三个顶点')
      .name('显示三个顶点')
      .onChange((visible: boolean) => {
        vertexDots.visible = visible
      })

    // 把参数挂到模块变量上，update 里就能读到
    spinSpeed = params
  },

  /**
   * 每帧都会被调用一次 —— 这就是"动画"的全部秘密：
   * 画面不是"播放"出来的，而是每帧按当前时间重算一遍再画出来。
   * dt 是两帧之间的间隔（秒），乘上它，运动速度才与帧率无关。
   */
  update(dt) {
    triangle.rotation.y += dt * spinSpeed.自转速度 * 0.9
    triangle.rotation.z = Math.sin(triangle.rotation.y * 0.5) * 0.12
    // 点云不共享变换（它是 triangle 的兄弟节点），要自己跟上去
    vertexDots.position.copy(triangle.position)
    vertexDots.rotation.copy(triangle.rotation)
  },
}

/** 章节内部状态：GUI 改的就是这个对象 */
let spinSpeed = { 自转速度: 0.7 }
