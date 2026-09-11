import * as THREE from 'three'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 09 · 关键帧动画系统
 *
 * three.js 自带动画系统，核心是三个类：
 *   KeyframeTrack  一条轨道：某属性的"时间点数组 + 值数组"
 *   AnimationClip  一组轨道 + 时长，就是一段动画
 *   AnimationMixer 播放器：每帧 mixer.update(dt)，它负责把轨道插值后写回属性
 *
 * 轨道靠"路径字符串"找到要改的属性，这是整个系统里最需要留意的地方：
 *   'jumpBall.position'          按对象**名字**找到节点，再改它的 position
 *   'glowBall.material.color'    一直往下钻到材质的 color
 *   '.rotation[y]'               以点开头 = 从绑定的根节点开始，直接访问属性
 * 路径里写错一个字母不会报错，只是"动画没反应" —— 排查时先怀疑路径。
 *
 * 本地用代码构造轨道，和从 glTF 里加载动画（第 16 章）是同一套机制，
 * 加载器只是替你把动画数据读出来、构造好轨道而已。
 */

let mixer: THREE.AnimationMixer | null = null
let actions: THREE.AnimationAction[] = []
let statusController: { updateDisplay(): unknown } | null = null
const params = {
  播放: true,
  速度: 1,
  循环: '循环',
  播完停在末帧: false,
  状态: '播放中',
}

/** 绕 Z 轴转 deg 度的四元数 */
function quaternionFromAngle(radians: number): number[] {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians).toArray()
}

export const animation: Chapter = {
  id: '09-animation',
  title: '关键帧动画系统',
  summary:
    '三个演员、三条轨道、一个播放器：跳跳球用 VectorKeyframeTrack 做位移，齿轮用 QuaternionKeyframeTrack 做旋转，彩球用 ColorKeyframeTrack 做颜色循环。重点体会"轨道 = 时间点 + 值数组"这件事 —— 一旦看懂，glTF 里那些动画数据也就能直接读懂了。',
  apis: [
    'AnimationMixer', 'AnimationClip', 'KeyframeTrack', 'VectorKeyframeTrack',
    'QuaternionKeyframeTrack', 'ColorKeyframeTrack', 'PropertyBinding 路径',
    'AnimationAction', 'setLoop', 'clampWhenFinished', 'timeScale', 'finished 事件',
  ],
  files: ['src/chapters/09-animation.ts', 'src/core/Label.ts'],
  camera: { radius: 16, theta: 0.42, phi: 1.05, target: [0, 2, 0] },

  build({ world, scene }) {
    world.ground(60)
    world.grid(28, 28)

    const key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(8, 14, 9)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -16
    key.shadow.camera.right = 16
    key.shadow.camera.top = 16
    key.shadow.camera.bottom = -16
    key.shadow.camera.far = 50
    key.shadow.camera.updateProjectionMatrix()
    scene.add(key)
    scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x2b3550, 1.2))

    // 一个播放器负责所有演员。绑定的根节点是整棵世界树，
    // 所以轨道里的路径要带上对象名字
    mixer = new THREE.AnimationMixer(world.root)

    // ---------------------------------------------------------- 演员 1：跳跳球
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0x8ad4ff, roughness: 0.3, metalness: 0.15 }),
    )
    ball.name = 'jumpBall'
    ball.position.set(-4.6, 0.5, 0)
    ball.castShadow = true
    world.add(ball)

    // 关键帧：时间点（秒）+ 值（位置是 xyz 三连，所以值的个数 = 时间点个数 × 3）
    const jumpTimes = [0, 0.34, 0.68, 1.02, 1.36]
    const jumpValues = [
      -4.6, 0.5, 0, // 落地
      -4.6, 3.8, 0, // 最高点
      -4.6, 0.5, 0, // 落地
      -4.6, 2.4, 0, // 弹起（矮一点）
      -4.6, 0.5, 0, // 落地
    ]
    const jumpTrack = new THREE.VectorKeyframeTrack('jumpBall.position', jumpTimes, jumpValues)
    // duration 传 -1 表示"用轨道里最后一个时间点"，省得自己算时长
    const jumpClip = new THREE.AnimationClip('jump', -1, [jumpTrack])

    // ---------------------------------------------------------- 演员 2：齿轮
    const gear = new THREE.Group()
    gear.name = 'gear'
    gear.position.set(0, 1.9, -3.4)
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 0.32, 24),
      new THREE.MeshStandardMaterial({ color: 0xffc98a, roughness: 0.32, metalness: 0.6 }),
    )
    // 圆柱默认轴向是 Y，转 90° 让它像一枚立起来的齿轮
    disc.rotation.x = Math.PI / 2
    gear.add(disc)

    const toothGeometry = new THREE.BoxGeometry(0.28, 0.34, 0.5)
    const toothMaterial = new THREE.MeshStandardMaterial({ color: 0xffb066, roughness: 0.35, metalness: 0.6 })
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2
      const tooth = new THREE.Mesh(toothGeometry, toothMaterial)
      tooth.position.set(Math.cos(angle) * 1.16, Math.sin(angle) * 1.16, 0)
      tooth.rotation.z = angle
      tooth.castShadow = true
      gear.add(tooth)
    }
    world.add(gear)

    // 四元数轨道：每一步 90°。四元数之间用球面插值（slerp），
    // 所以"分四步转一圈"和"直接一步转一圈"的结果完全一样 —— 这就是它的好处
    const spinTimes = [0, 0.5, 1.0, 1.5, 2.0]
    const spinValues = [
      ...quaternionFromAngle(0),
      ...quaternionFromAngle(Math.PI / 2),
      ...quaternionFromAngle(Math.PI),
      ...quaternionFromAngle(Math.PI * 1.5),
      ...quaternionFromAngle(Math.PI * 2),
    ]
    const spinTrack = new THREE.QuaternionKeyframeTrack('gear.quaternion', spinTimes, spinValues)
    const spinClip = new THREE.AnimationClip('spin', -1, [spinTrack])

    // ---------------------------------------------------------- 演员 3：霓虹球
    const glowBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 40, 28),
      // 用不受光材质，颜色变化最直观
      new THREE.MeshBasicMaterial({ color: 0xff6b6b }),
    )
    glowBall.name = 'glowBall'
    glowBall.position.set(4.6, 1.1, 0)
    world.add(glowBall)

    // 颜色轨道：值是 RGB 三连（0~1）。
    // 首尾颜色写成一样，循环时接缝才不会突然跳一下
    const colorTimes = [0, 1, 2, 3, 4]
    const colorValues = [
      1.0, 0.42, 0.42,
      0.42, 1.0, 0.62,
      0.5, 0.7, 1.0,
      1.0, 0.85, 0.42,
      1.0, 0.42, 0.42,
    ]
    const colorTrack = new THREE.ColorKeyframeTrack('glowBall.material.color', colorTimes, colorValues)
    const colorClip = new THREE.AnimationClip('glow', -1, [colorTrack])

    // ---------------------------------------------------------- 播放
    // clipAction(clip, root?) 省略第二个参数就用 mixer 绑定时的根节点
    actions = [mixer.clipAction(jumpClip), mixer.clipAction(spinClip), mixer.clipAction(colorClip)]
    for (const action of actions) {
      action.setLoop(THREE.LoopRepeat, Infinity)
      action.play()
    }

    // 播放一次结束时触发：适合做"播完切下一个动作"这类逻辑
    mixer.addEventListener('finished', () => {
      params.状态 = '一次播放结束'
      statusController?.updateDisplay()
    })

    // ---------------------------------------------------------- 标签与面板
    const labels = [
      { text: 'VectorKeyframeTrack · 位移', position: new THREE.Vector3(-4.6, 5.2, 0) },
      { text: 'QuaternionKeyframeTrack · 旋转', position: new THREE.Vector3(0, 4.1, -3.4) },
      { text: 'ColorKeyframeTrack · 颜色', position: new THREE.Vector3(4.6, 3.2, 0) },
    ]
    for (const item of labels) {
      const label = createLabel(item.text, { size: 0.34 })
      label.position.copy(item.position)
      world.add(label)
    }

    const folder = world.folder('第 09 章')
    statusController = folder.add(params, '状态').disable()
    folder
      .add(params, '播放')
      .name('播放')
      .onChange((v: boolean) => {
        for (const action of actions) action.paused = !v
      })
    folder
      .add(params, '速度', 0, 3, 0.05)
      .name('播放速度 timeScale')
      .onChange((v: number) => {
        if (mixer) mixer.timeScale = v
      })
    folder
      .add(params, '循环', ['循环', '播放一次', '来回'])
      .name('循环方式')
      .onChange((mode: string) => {
        const loop =
          mode === '播放一次' ? THREE.LoopOnce : mode === '来回' ? THREE.LoopPingPong : THREE.LoopRepeat
        for (const action of actions) action.setLoop(loop, Infinity)
      })
    folder
      .add(params, '播完停在末帧')
      .name('播完停在末帧')
      .onChange((v: boolean) => {
        // 只对 LoopOnce 有意义：否则播完会回到起始姿势
        for (const action of actions) action.clampWhenFinished = v
      })
    folder
      .add(
        {
          重播: () => {
            params.状态 = '播放中'
            statusController?.updateDisplay()
            for (const action of actions) {
              action.reset()
              action.paused = !params.播放
              action.play()
            }
          },
        },
        '重播',
      )
      .name('从头重播')
  },

  update(dt) {
    // 整段动画只有这一行：mixer 每帧按 dt 推进，把插值结果写回各个属性
    mixer?.update(dt)
  },

  dispose() {
    // mixer 会一直持有对场景里对象的引用，切章时务必停掉
    mixer?.stopAllAction()
    mixer = null
    actions = []
    statusController = null
  },
}
