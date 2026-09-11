import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 16 · 加载与导出：序列化那一趟来回
 *
 * 真实项目里"加载模型"就是 FileLoader 下载 + GLTFLoader 解析；
 * 但本章不依赖任何素材文件，而是反过来演一遍：
 *
 *   用代码搭一个小模型 → GLTFExporter 导出成二进制 glTF → GLTFLoader 解析回来
 *
 * 这一趟来回把两件事讲透了：
 *   1. glTF 是"运行时可读的场景图 + 几何 + 材质 + 动画"，跟 three 的对象一一对应；
 *   2. 加载器做的事就是把文件里的数据翻译成 Mesh / Material / AnimationClip，
 *      和你在第 02、03、09 章手写的那些东西完全同类。
 *
 * 另外演示了 Object3D.toJSON / ObjectLoader：three 自带的另一种序列化格式。
 * 真实项目里还会用到 DRACOLoader（压缩几何）、KTX2Loader（压缩贴图）、
 * MeshoptDecoder，用法都是 setDecoder 到 GLTFLoader 上，原理不变。
 */

let gltfCopy: THREE.Object3D | null = null
let jsonCopy: THREE.Object3D | null = null
let stateController: { updateDisplay(): unknown } | null = null

const info = { 状态: '准备中…', glTF字节数: '-', glTF节点数: '-', 耗时: '-' }

/** 用基础几何体搭一个"小灯塔"，作为要被序列化的原型 */
function buildPrototype(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'lighthouse'

  // 底座
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.8, 0.6, 24),
    new THREE.MeshStandardMaterial({ color: 0x5c6b93, roughness: 0.7, metalness: 0.2 }),
  )
  base.position.y = 0.3
  group.add(base)

  // 塔身
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 1.1, 3.2, 20),
    new THREE.MeshStandardMaterial({ color: 0xdbe4ff, roughness: 0.5, metalness: 0.15 }),
  )
  body.position.y = 2.2
  group.add(body)

  // 红色环带：靠"位置 + 同一个几何体"复用，不必新建
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xff5a6b, roughness: 0.55 })
  for (const y of [1.6, 2.9]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.98 - (y - 1.6) * 0.1, 1.0 - (y - 1.6) * 0.1, 0.3, 20), ringMaterial)
    ring.position.y = y
    group.add(ring)
  }

  // 灯室
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 28, 20),
    new THREE.MeshStandardMaterial({
      color: 0x2a2f45,
      roughness: 0.2,
      metalness: 0.6,
      emissive: new THREE.Color(0xffd98a),
      emissiveIntensity: 1.4,
    }),
  )
  lamp.position.y = 4.2
  group.add(lamp)

  // 天线
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x9fb4ff, roughness: 0.4, metalness: 0.7 }),
  )
  antenna.position.y = 5.1
  group.add(antenna)

  return group
}

export const serialization: Chapter = {
  id: '16-serialization',
  title: '加载与导出：序列化',
  summary:
    '先用代码搭一座小灯塔，然后把它导出成二进制 glTF，再原样解析回来：中间那两份副本是"从文件重新读出来的模型"，和左边手工搭的原型长得一模一样。顺手用 ObjectLoader 再走一遍 three 自带的 JSON 格式，并说明真实项目里 DRACO / KTX2 这些压缩解码器是怎么接进来的。',
  apis: [
    'GLTFExporter', 'binary glTF', 'GLTFLoader.parse', 'gltf.scene', 'gltf.animations',
    'Object3D.toJSON', 'ObjectLoader', 'LoadingManager', 'DRACOLoader / KTX2Loader',
  ],
  files: ['src/chapters/16-serialization.ts', 'src/core/Label.ts'],
  camera: { radius: 22, theta: 0.55, phi: 1.02, target: [0, 2.6, 0] },

  build({ world, scene }) {
    world.ground(70)
    world.grid(30, 30)

    const key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(9, 14, 10)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -20
    key.shadow.camera.right = 20
    key.shadow.camera.top = 20
    key.shadow.camera.bottom = -20
    key.shadow.camera.far = 50
    key.shadow.camera.updateProjectionMatrix()
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2b3550, 1.3))

    // ---- 原型 ----
    const prototype = buildPrototype()
    world.add(prototype)

    const labels = [
      { text: '原型（代码搭的）', position: new THREE.Vector3(0, 6.6, 0) },
      { text: 'glTF 往返副本', position: new THREE.Vector3(8, 6.6, 0) },
      { text: 'ObjectLoader 副本', position: new THREE.Vector3(-8, 6.6, 0) },
    ]
    for (const item of labels) {
      const label = createLabel(item.text, { size: 0.52 })
      label.position.copy(item.position)
      world.add(label)
    }

    const folder = world.folder('第 16 章')
    stateController = folder.add(info, '状态').disable()
    folder.add(info, 'glTF字节数').disable()
    folder.add(info, 'glTF节点数').disable()
    folder.add(info, '耗时').disable()

    // ================================================== glTF 往返
    const started = performance.now()
    const exporter = new GLTFExporter()

    // parse(input, onDone, onError, options)
    // binary: true 得到 .glb（几何用二进制，解析更快、体积更小）
    exporter.parse(
      prototype,
      (result) => {
        if (!(result instanceof ArrayBuffer)) {
          info.状态 = '导出结果不是二进制，检查 binary 选项'
          stateController?.updateDisplay()
          return
        }

        info.glTF字节数 = `${result.byteLength.toLocaleString('en-US')} B`
        info.状态 = '导出完成，开始解析…'
        stateController?.updateDisplay()

        const loader = new GLTFLoader()
        // parse(data, path, onLoad, onError)：path 是"贴图等资源的相对目录"，这里没有外部资源
        loader.parse(
          result,
          '',
          (gltf) => {
            gltfCopy = gltf.scene
            gltfCopy.position.set(8, 0, 0)
            world.add(gltfCopy)

            // 从 glTF 里读出来的动画片段，直接就能喂给 AnimationMixer（第 09 章）
            info.状态 = `解析完成（动画 ${gltf.animations.length} 段）`
            info.耗时 = `${(performance.now() - started).toFixed(1)} ms`
            let nodes = 0
            gltfCopy.traverse(() => nodes++)
            info.glTF节点数 = String(nodes)
            stateController?.updateDisplay()
          },
          (error) => {
            info.状态 = '解析失败，看控制台'
            stateController?.updateDisplay()
            console.error('[16-serialization] GLTFLoader 解析失败', error)
          },
        )
      },
      (error) => {
        info.状态 = '导出失败，看控制台'
        stateController?.updateDisplay()
        console.error('[16-serialization] GLTFExporter 导出失败', error)
      },
      { binary: true },
    )

    // ================================================== three 自带 JSON 往返
    // toJSON() 把整棵子树变成普通对象，ObjectLoader 再把它还原成 Object3D。
    // 适合存"场景快照"，但几何和贴图会被展开成很占体积的数据，不适合大场景
    try {
      const json = prototype.toJSON()
      jsonCopy = new THREE.ObjectLoader().parse(json)
      jsonCopy.position.set(-8, 0, 0)
      world.add(jsonCopy)
    } catch (error) {
      console.error('[16-serialization] ObjectLoader 还原失败', error)
    }
  },

  update() {
    // 顺时针慢慢转，方便对比三份模型是否一致
    if (gltfCopy) gltfCopy.rotation.y += 0.004
    if (jsonCopy) jsonCopy.rotation.y += 0.004
  },

  dispose() {
    gltfCopy = null
    jsonCopy = null
    stateController = null
    info.状态 = '准备中…'
  },
}
