import * as THREE from 'three'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 12 · 骨骼与形变
 *
 * 两种"让模型动起来"的方式，都不需要重新生成几何体：
 *
 * 1) 骨骼蒙皮 SkinnedMesh
 *    几何体上多两个属性：skinIndex（这个顶点受哪 4 根骨头影响）
 *                     skinWeight（每根骨头各占多大权重，加起来为 1）
 *    渲染时顶点位置 = 各骨骼矩阵 × 绑定时的相对位置 × 权重 之和。
 *    也就是说：**顶点是被骨头拽着走的**，权重就是"拽多紧"。
 *
 * 2) 形变目标 morphTargets
 *    同一个几何体存两份顶点位置（原形 + 变形），用 0~1 的权重在两者之间插值。
 *    做表情、胖瘦变化这类"形状本身在变"的效果最合适。
 *
 * 两者的共同点：顶点数据都只有一份，改动的是"怎么解算它"。
 */

const BONE_COUNT = 5
/** 相邻两根骨头的间距 */
const SEGMENT = 1.0
/** 尾巴总高度 = 4 */
const TAIL_HEIGHT = SEGMENT * (BONE_COUNT - 1)

let bones: THREE.Bone[] = []
let skinned: THREE.SkinnedMesh | null = null
let morphMesh: THREE.Mesh | null = null
let wiggleTime = 0

const params = { 摆动幅度: 0.24, 摆动速度: 2.2, 尖刺程度: 0, 显示骨骼: false }
const morphInfo = { 尖刺程度: 0 }

export const rigging: Chapter = {
  id: '12-rigging',
  title: '骨骼与形变',
  summary:
    '手工给一根圆柱刷上蒙皮权重，串起 5 根骨头做一条会甩的尾巴 —— 你会看到"权重"是怎么决定哪一段被哪根骨头拽动的。旁边那颗球用 morphTargets 在"光滑"和"长刺"之间变形，面板上的滑块直接就是 morphTargetInfluences 的值。',
  apis: [
    'Bone', 'Skeleton', 'SkinnedMesh', 'skinIndex', 'skinWeight', 'bind',
    'SkeletonHelper', 'morphAttributes', 'morphTargetInfluences', 'updateMorphTargets',
    'morphTargetDictionary',
  ],
  files: ['src/chapters/12-rigging.ts', 'src/core/Label.ts'],
  camera: { radius: 13, theta: 0.4, phi: 1.03, target: [0, 2.6, 0] },

  build({ world, scene }) {
    world.ground(60)
    world.grid(26, 26)

    const key = new THREE.DirectionalLight(0xffffff, 2.5)
    key.position.set(7, 12, 8)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -14
    key.shadow.camera.right = 14
    key.shadow.camera.top = 14
    key.shadow.camera.bottom = -14
    key.shadow.camera.far = 40
    key.shadow.camera.updateProjectionMatrix()
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2b3550, 1.2))

    // ================================================== 1. 骨骼蒙皮：会甩的尾巴
    // 圆柱默认沿 Y 轴，y 从 -2 到 +2
    const tailGeometry = new THREE.CylinderGeometry(0.16, 0.46, TAIL_HEIGHT, 20, 24)

    // ---- 骨骼链 ----
    bones = []
    for (let i = 0; i < BONE_COUNT; i++) {
      const bone = new THREE.Bone()
      // 第一根放在尾巴根部（局部 y = -2），其余每根相对父骨头上移一个 SEGMENT。
      // 注意 Bone.position 是**相对父骨骼**的偏移，这就是"链式"的含义
      bone.position.y = i === 0 ? -TAIL_HEIGHT / 2 : SEGMENT
      if (i > 0) bones[i - 1].add(bone)
      bones.push(bone)
    }

    // ---- 蒙皮权重 ----
    // 这是全场最"手工"的一步：真实项目里由建模软件刷好，这里用高度自动算
    const position = tailGeometry.attributes.position
    const skinIndices: number[] = []
    const skinWeights: number[] = []
    const bottom = -TAIL_HEIGHT / 2

    for (let i = 0; i < position.count; i++) {
      // 把顶点高度映射成"第几根骨头的浮点位置"：
      // 0 = 完全由 bones[0] 控制，3.5 = 一半 bones[3] 一半 bones[4]
      const level = THREE.MathUtils.clamp((position.getY(i) - bottom) / SEGMENT, 0, BONE_COUNT - 1)
      const lower = Math.min(Math.floor(level), BONE_COUNT - 1)
      const upper = Math.min(lower + 1, BONE_COUNT - 1)
      const blend = level - lower

      // 每根骨头的权重加起来必须等于 1，否则顶点会被拉向原点（变形会"塌"掉）
      skinIndices.push(lower, upper, 0, 0)
      skinWeights.push(1 - blend, blend, 0, 0)
    }

    tailGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
    tailGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))
    // 蒙皮需要额外的顶点属性（每个顶点 4 个索引 + 4 个权重），显存开销比普通网格大

    skinned = new THREE.SkinnedMesh(
      tailGeometry,
      new THREE.MeshStandardMaterial({ color: 0x8fe0c8, roughness: 0.42, metalness: 0.18 }),
    )
    skinned.position.set(-4.6, 2.7, 0)
    skinned.castShadow = true
    skinned.receiveShadow = true

    // 骨架的根骨骼必须挂进场景图，否则它（以及整条链）的世界矩阵不会更新
    skinned.add(bones[0])
    // bind() 会记录"绑定这一刻"骨骼与网格的相对关系（bindMatrix 与各骨骼的逆矩阵）。
    // 之后无论骨骼怎么动，顶点都按"相对绑定姿势的偏移"被拖走
    skinned.bind(new THREE.Skeleton(bones))
    world.add(skinned)

    // 骨架可视化：直接看到骨头的位置和朝向
    const skeletonHelper = new THREE.SkeletonHelper(skinned)
    skeletonHelper.visible = false
    world.add(skeletonHelper)

    const tailLabel = createLabel('SkinnedMesh · 5 根骨骼 / 蒙皮权重', { size: 0.36 })
    tailLabel.position.set(-4.6, 5.6, 0)
    world.add(tailLabel)

    // ================================================== 2. morphTargets：球 ↔ 刺球
    const baseGeometry = new THREE.SphereGeometry(1.2, 64, 44)
    const targetGeometry = baseGeometry.clone()
    const targetPosition = targetGeometry.attributes.position
    const vertex = new THREE.Vector3()

    for (let i = 0; i < targetPosition.count; i++) {
      vertex.fromBufferAttribute(targetPosition, i)
      const outward = vertex.clone().normalize()
      // 三个方向的 sin 相乘 → 一串均匀分布的凸起，像菠萝
      const bump = Math.sin(outward.x * 11) * Math.sin(outward.y * 11) * Math.sin(outward.z * 11)
      vertex.addScaledVector(outward, bump * 0.3)
      targetPosition.setXYZ(i, vertex.x, vertex.y, vertex.z)
    }
    targetPosition.needsUpdate = true
    targetGeometry.computeVertexNormals()

    morphMesh = new THREE.Mesh(
      baseGeometry,
      new THREE.MeshStandardMaterial({ color: 0xffc98a, roughness: 0.38, metalness: 0.22 }),
    )
    morphMesh.position.set(4.6, 2.2, 0)
    morphMesh.castShadow = true
    world.add(morphMesh)

    // morphAttributes.position 里存的是**目标形状的绝对顶点位置**
    // （morphTargetsRelative 默认为 false，所以不是"偏移量"）
    targetPosition.name = 'spiked'
    baseGeometry.morphAttributes.position = [targetPosition]
    baseGeometry.morphAttributes.normal = [targetGeometry.attributes.normal]
    // ★ morph 目标是后加的，必须手动刷新一次，
    //   否则 morphTargetInfluences 还是空的 —— 这条很容易踩坑
    ;(morphMesh as THREE.Mesh).updateMorphTargets()

    const morphLabel = createLabel('morphTargets · 形状插值', { size: 0.36 })
    morphLabel.position.set(4.6, 5.2, 0)
    world.add(morphLabel)

    // ================================================== 面板
    const folder = world.folder('第 12 章')
    folder.add(params, '摆动幅度', 0, 0.6, 0.01).name('摆动幅度')
    folder.add(params, '摆动速度', 0, 5, 0.05).name('摆动速度')
    folder
      .add(params, '显示骨骼')
      .name('显示骨骼')
      .onChange((v: boolean) => (skeletonHelper.visible = v))
    folder
      .add(morphInfo, '尖刺程度', 0, 1, 0.01)
      .name('尖刺程度 = morphTargetInfluences[0]')
      .onChange((v: number) => {
        // 滑块的值直接就是那个 0~1 的权重
        const influences = morphMesh?.morphTargetInfluences
        if (influences) influences[0] = v
      })

    // 上面为了展示字典，顺手把 morphTargetDictionary 打出来看看
    console.log('[12-rigging] morph 目标字典：', morphMesh.morphTargetDictionary)
  },

  update(dt) {
    wiggleTime += dt

    for (let i = 0; i < bones.length; i++) {
      // 相位沿着骨骼链依次延迟，摆动就会像波浪一样从根部传到梢部
      const phase = wiggleTime * params.摆动速度 - i * 0.75
      // 越靠梢部摆得越夸张
      const falloff = 0.35 + (i / (BONE_COUNT - 1)) * 0.95
      // 只改每根骨头自己的旋转，整条链的顶点就都被带动了
      bones[i].rotation.z = Math.sin(phase) * params.摆动幅度 * falloff
      bones[i].rotation.x = Math.cos(phase * 0.85) * params.摆动幅度 * 0.7 * falloff
    }
  },

  dispose() {
    bones = []
    skinned = null
    morphMesh = null
    wiggleTime = 0
  },
}
