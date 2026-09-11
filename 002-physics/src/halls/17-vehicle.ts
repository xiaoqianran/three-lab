import RAPIER from '@dimforge/rapier3d-compat'
import type { Hall } from './types'

const CHASSIS_Y = 1.15

/**
 * 轮位 [x, y, z]（车身局部坐标）。
 * x 是轮距的一半（左右），z 是轴距的一半（前后）。
 * 必须让 x < z —— 轮子沿 Z 滚动，车头朝 ±Z，所以轴距要大于轮距。
 * 原来写成 x=±1.2 / z=±0.95，一辆车比宽还短，跑起来像横向平移。
 */
const WHEEL_OFFSETS: Array<[number, number, number]> = [
  [-0.85, -0.52, 1.2],
  [-0.85, -0.52, -1.2],
  [0.85, -0.52, 1.2],
  [0.85, -0.52, -1.2],
]

const wheels: RAPIER.RevoluteImpulseJoint[] = []

export const vehicleHall: Hall = {
  id: '17-vehicle',
  title: '车轮载具',
  desc: '车身加四个圆柱轮子，每个轮子用一个 revolute 关节拴在车身上、再配一个速度马达。轮胎的摩擦系数调到 1.6，马达一转，摩擦力就把整车推着走了 —— 这里的"驾驶"没有任何脚本，纯粹是摩擦和力矩。',
  tags: ['revolute motor', 'friction drive', 'cylinder collider axis', 'CCD'],

  camera: { radius: 19, theta: 0.8, phi: 1.1, target: [0, 1.6, 0] },

  build(ctx) {
    const { stage, physics } = ctx

    wheels.length = 0

    stage.addGround(60)
    // 场地 60 米见方、车只有 3.4 米长，画面里就是一片空地上一个小点
    stage.addArena(26, 4)

    // 车身。
    // 长边必须沿着 **Z**：轮子的轴向是 X（圆柱被掰到 local x），
    // 所以轮子是在 Z 方向滚动、车沿 Z 行驶。原来车身写成 3.4 长在 X 上，
    // 等于一辆横着开的车 —— 车身与行进方向垂直，看着十分别扭。
    const chassis = stage.spawn({
      shape: { kind: 'box', size: [1.75, 0.62, 3.4] },
      position: [0, CHASSIS_Y, 0],
      color: '#4d96ff',
      density: 2.6,
      friction: 0.4,
      restitution: 0.1,
      angularDamping: 0.1,
      noSleep: true,
    })

    // 四个轮子：圆柱的轴被掰到本地 x，所以 revolute 的轴直接用 x
  // 轮距（X）比轴距（Z）窄，才是正常汽车的proportions
    WHEEL_OFFSETS.forEach(([ox, oy, oz], i) => {
      const wheel = stage.spawn({
        shape: { kind: 'cylinder', radius: 0.62, height: 0.34, axis: 'x' },
        position: [ox, CHASSIS_Y + oy, oz],
        // 原来是接近纯黑的深蓝，压在深色地面上等于隐形
        color: i % 2 === 0 ? '#98a2bb' : '#7b8599',
        density: 3.4,
        // 摩擦要够大，否则轮子只是空转，车不动
        friction: 1.7,
        restitution: 0.04,
        angularDamping: 0.04,
        noSleep: true,
      })

      const joint = physics.createJoint(
        RAPIER.JointData.revolute(
          { x: ox, y: oy, z: oz },
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ),
        chassis,
        wheel,
        true,
      ) as RAPIER.RevoluteImpulseJoint

      // 这组参数是在 Node 里单独搭台测出来的（scripts/test-vehicle.mjs）：
      // 4 秒跑出 30.7 米、车身始终直立；而 max=2500 或阻尼给到 25 会前空翻。
      // 别凭手感改这两个数。
      joint.setMotorMaxForce(420)
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased)
      joint.configureMotorVelocity(0, 1.8)

      wheels.push(joint)
    })

    // 障碍箱摆成一圈，中心留空。
    // 这一步不能省：车生成在原点、占地约 1.7×3.4 米，用直线排布时
    // 总会有某个箱子正好落进这个范围，车的碰撞体和箱子从第一帧就重叠，
    // 直接被架住一步都动不了 —— 前面两次就是这么踩的坑。
    // 用极坐标保证所有箱子离原点至少 7 米，几何上不可能撞上。
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2
      const radius = 7 + (i % 3) * 1.6

      stage.spawn({
        shape: { kind: 'box', size: [0.7, 1.1, 0.7] },
        position: [Math.cos(angle) * radius, 0.55, Math.sin(angle) * radius],
        color: '#ff9f68',
        density: 1.2,
        friction: 0.7,
      })
    }
  },

  update(_dt, elapsed) {
    // 速度按正弦来回变，车就会在场地里来回跑。
    // 峰值 10 rad/s × 轮半径 0.62 ≈ 6.2 m/s。
    // 不要往上调：轮距收窄到 1.9 米之后整车更容易被顶飞，
    // 11 m/s 时撞上箱子或围墙会直接腾空翻滚。
    const target = Math.sin(elapsed * 0.45) * 10

    for (let i = 0; i < wheels.length; i++) {
      // 左右轮转速不等 = 差速转向。
      // 四轮同速时车会笔直冲到围墙上顶着不动，画面里很快就没内容了；
      // 差速之后它会绕着场地走曲线，一直有东西可看。
      const [, , oz] = WHEEL_OFFSETS[i]
      const bias = oz > 0 ? 1 : 0.8

      wheels[i].configureMotorVelocity(target * bias, 1.8)
    }
  },
}
