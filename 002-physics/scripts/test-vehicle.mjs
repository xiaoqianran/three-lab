/**
 * 车轮载具的驱动测试。
 * 只关心一件事：给了马达参数，车身到底动没动、有没有翻。
 * 在 Node 里跑，几秒钟就能试一组参数。
 */
import RAPIER from '@dimforge/rapier3d-compat'

await RAPIER.init()

const CHASSIS_Y = 1.15
const WHEEL_R = 0.62
const WHEEL_OFFSETS = [
  [-0.85, -0.52, 1.2],
  [-0.85, -0.52, -1.2],
  [0.85, -0.52, 1.2],
  [0.85, -0.52, -1.2],
]

function run(label, { model, maxForce, damping, target }) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.integrationParameters.numSolverIterations = 20

  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0))
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(60, 0.3, 60).setFriction(0.9).setRestitution(0.05),
    ground,
  )

  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, CHASSIS_Y, 0).setLinearDamping(0.1),
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.875, 0.31, 1.7)
      .setDensity(2.6)
      .setFriction(0.4)
      .setRestitution(0.1),
    chassis,
  )

  const wheels = []

  for (const [ox, oy, oz] of WHEEL_OFFSETS) {
    const wheel = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(ox, CHASSIS_Y + oy, oz),
    )
    // 圆柱轴掰到本地 x
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.17, WHEEL_R)
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
        .setDensity(3.4)
        .setFriction(1.7)
        .setRestitution(0.04),
      wheel,
    )

    const joint = world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: ox, y: oy, z: oz }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      chassis,
      wheel,
      true,
    )
    joint.setContactsEnabled(false)
    joint.setMotorMaxForce(maxForce)
    joint.configureMotorModel(model)
    joint.configureMotorVelocity(target, damping)
    wheels.push(joint)
  }

  const totalMass =
    chassis.mass() + wheels.reduce((sum, _, i) => sum + 0, 0)

  const start = chassis.translation()

  for (let i = 0; i < 60 * 4; i++) {
    // 保持目标转速不变（比正弦更便于判断）
    for (const w of wheels) w.configureMotorVelocity(target, damping)
    world.step()
  }

  const end = chassis.translation()
  const rot = chassis.rotation()
  // 从四元数还原出"车顶朝上"的程度：翻转后 y 分量会变负
  const upY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z)

  const dist = Math.hypot(end.x - start.x, end.z - start.z)

  world.free()

  const moved = dist > 1 ? 'MOVED' : 'STUCK'
  const flipped = upY < 0.5 ? 'FLIPPED' : 'upright'

  console.log(
    `${moved.padEnd(6)} ${flipped.padEnd(7)} ${label.padEnd(40)} dist=${dist.toFixed(2)}m y=${end.y.toFixed(2)} mass=${totalMass.toFixed(2)}`,
  )
}

const F = RAPIER.MotorModel.ForceBased
const A = RAPIER.MotorModel.AccelerationBased

// 马达目标：18 rad/s，约 11 m/s
run('ForceBased  max=420  damp=1.8', { model: F, maxForce: 420, damping: 1.8, target: 18 })
run('ForceBased  max=2500 damp=25', { model: F, maxForce: 2500, damping: 25, target: 18 })
run('ForceBased  max=30   damp=10', { model: F, maxForce: 30, damping: 10, target: 18 })
run('ForceBased  max=200  damp=40', { model: F, maxForce: 200, damping: 40, target: 18 })
run('AccelBased  max=420  damp=1.2', { model: A, maxForce: 420, damping: 1.2, target: 18 })
run('AccelBased  max=420  damp=2.2', { model: A, maxForce: 420, damping: 2.2, target: 18 })
run('AccelBased  max=800  damp=6', { model: A, maxForce: 800, damping: 6, target: 18 })
run('ForceBased  max=420  damp=1.8 tgt=8', { model: F, maxForce: 420, damping: 1.8, target: 8 })
run('ForceBased  max=150  damp=25  tgt=18', { model: F, maxForce: 150, damping: 25, target: 18 })
