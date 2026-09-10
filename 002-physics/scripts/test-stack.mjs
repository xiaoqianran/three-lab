/**
 * 精确复刻 02-stack 展厅（含地面、围墙、阻尼），跑 5 秒看有没有东西被炸飞。
 * 只测物理，不渲染 —— 比截图快两个数量级。
 */
import RAPIER from '@dimforge/rapier3d-compat'

await RAPIER.init()

const ROWS = 9
const COLS = 13
const BLOCK = 0.86
const SIZE = BLOCK
const HALF_DEPTH = BLOCK * 0.3

function scenario(label, { withArena, withDamping }) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.integrationParameters.numSolverIterations = 20

  // ---- 地面 ----
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.3, 0))
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(30, 0.3, 30).setFriction(0.9).setRestitution(0.05),
    ground,
  )

  // ---- 围墙 ----
  if (withArena) {
    const wall = (pos, rot) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]),
      )
      if (rot) body.setRotation({ x: rot[0], y: rot[1], z: rot[2], w: rot[3] })
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(22, 3.5, 0.5).setFriction(0.4).setRestitution(0.3),
        body,
      )
    }

    const q90 = Math.SQRT1_2
    wall([0, 3.5, -22], null)
    wall([0, 3.5, 22], null)
    wall([-22, 3.5, 0], [0, q90, 0, q90])
    wall([22, 3.5, 0], [0, q90, 0, q90])
  }

  // ---- 砖 ----
  const bricks = []

  for (let row = 0; row < ROWS; row++) {
    const offset = (row % 2) * SIZE * 0.5
    const y = SIZE / 2 + row * SIZE

    for (let col = 0; col < COLS; col++) {
      const x = (col - (COLS - 1) / 2) * SIZE + offset

      const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, 0)
      if (withDamping) desc.setLinearDamping(0.15).setAngularDamping(0.25)

      const body = world.createRigidBody(desc)
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(SIZE / 2, SIZE / 2, HALF_DEPTH)
          .setFriction(1.0)
          .setRestitution(0)
          .setDensity(1.2),
        body,
      )

      bricks.push(body)
    }
  }

  for (let i = 0; i < 60 * 5; i++) world.step()

  let maxSpeed = 0
  let fastestAt = null
  let maxY = -Infinity
  let awake = 0

  for (const b of bricks) {
    const v = b.linvel()
    const t = b.translation()
    const speed = Math.hypot(v.x, v.y, v.z)

    if (speed > maxSpeed) {
      maxSpeed = speed
      fastestAt = `(${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)})`
    }
    maxY = Math.max(maxY, t.y)
    if (!b.isSleeping()) awake++
  }

  world.free()

  console.log(
    `${label.padEnd(30)} maxSpeed=${maxSpeed.toFixed(2)} maxY=${maxY.toFixed(2)} awake=${awake}/${bricks.length} at=${fastestAt}`,
  )
}

scenario('no arena, no damping', { withArena: false, withDamping: false })
scenario('no arena, damping', { withArena: false, withDamping: true })
scenario('arena, no damping', { withArena: true, withDamping: false })
scenario('arena + damping (当前展厅)', { withArena: true, withDamping: true })
