import RAPIER from '@dimforge/rapier3d-compat'

await RAPIER.init()
console.log('rapier init ok')

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })

function test(nrows, ncols, scale, label) {
  try {
    const heights = new Float32Array(nrows * ncols)
    for (let i = 0; i < heights.length; i++) heights[i] = Math.sin(i * 0.13) * 2

    const desc = RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, scale)
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    world.createCollider(desc, body)

    console.log(`OK   nrows=${nrows} ncols=${ncols} len=${heights.length} scale=${JSON.stringify(scale)}  (${label})`)
    return true
  } catch (error) {
    console.log(`FAIL nrows=${nrows} ncols=${ncols} scale=${JSON.stringify(scale)}  (${label}): ${error}`)
    return false
  }
}

test(2, 2, { x: 10, y: 1, z: 10 }, 'minimal 2x2')
test(8, 8, { x: 10, y: 1, z: 10 }, 'small')
test(64, 64, { x: 96, y: 1, z: 96 }, 'medium')
test(110, 110, { x: 96, y: 1, z: 96 }, 'current setting')
test(110, 110, { x: 96, y: 96, z: 96 }, 'scale.y non-1')
test(256, 256, { x: 96, y: 1, z: 96 }, 'large')

// 试试不带 scale
try {
  const heights = new Float32Array(64 * 64)
  const desc = RAPIER.ColliderDesc.heightfield(64, 64, heights, { x: 96, y: 1, z: 96 }, undefined)
  console.log('OK   with explicit undefined flags')
  void desc
} catch (error) {
  console.log('FAIL with explicit undefined flags:', error)
}
