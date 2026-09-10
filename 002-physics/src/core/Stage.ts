import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from './PhysicsWorld'

// ============================================================
//  形状描述
// ============================================================

export type ShapeSpec =
  | { kind: 'box'; size: [number, number, number] }
  | { kind: 'ball'; radius: number }
  | { kind: 'capsule'; radius: number; height: number }
  /** axis 只是把渲染几何和碰撞体一起转过去，刚体本身朝向不变 —— 车轮需要这个 */
  | { kind: 'cylinder'; radius: number; height: number; axis?: 'x' | 'y' | 'z' }
  | { kind: 'cone'; radius: number; height: number }
  | { kind: 'roundBox'; size: [number, number, number]; radius: number }
  /** 凸包：id 用来区分不同的点集，几何会缓存 */
  | { kind: 'convex'; id: string; points: Float32Array }
  /** 没有渲染几何的纯碰撞体（比如纯静态地形），只加物理 */
  | { kind: 'phantom'; size: [number, number, number] }

export type BodyKind = 'dynamic' | 'fixed' | 'kinematicPosition' | 'kinematicVelocity'

export interface BodySpec {
  shape: ShapeSpec
  position: [number, number, number]
  /** 四元数 xyzw */
  rotation?: [number, number, number, number]
  kind?: BodyKind
  density?: number
  restitution?: number
  friction?: number
  color?: THREE.ColorRepresentation
  /** 高速物体必须开，否则会穿墙 */
  ccd?: boolean
  /** 关掉休眠，用于需要一直模拟的物体 */
  noSleep?: boolean
  /** 线性阻尼，抑制抖动 */
  linearDamping?: number
  angularDamping?: number
  /** 传感器：不产生碰撞响应，只报告碰撞事件 */
  sensor?: boolean
}

interface ShapeDef {
  key: string
  geometry: THREE.BufferGeometry
  /** phantom 形状不参与渲染 */
  invisible?: boolean
}

/**
 * 实例缩放必须**每次现算**，绝不能进 ShapeDef 缓存。
 *
 * box / ball / phantom 复用单位几何、靠 instanceMatrix 缩放，所以它们的 shapeKey
 * 是固定字符串，一堆不同尺寸的物体会共用同一个 def。尺寸一旦进缓存，
 * 第一个 spawn 的尺寸就会污染后面所有同 key 的物体。
 */
function scaleOf(shape: ShapeSpec): THREE.Vector3 {
  switch (shape.kind) {
    case 'box':
      return new THREE.Vector3(shape.size[0], shape.size[1], shape.size[2])
    case 'ball':
      return new THREE.Vector3(shape.radius, shape.radius, shape.radius)
    case 'phantom':
      return new THREE.Vector3(shape.size[0], shape.size[1], shape.size[2])
    default:
      return new THREE.Vector3(1, 1, 1)
  }
}

interface Bucket {
  key: string
  mesh: THREE.InstancedMesh
  capacity: number
  count: number
  /** 按 slot 存的颜色，扩容时用来重放 */
  colorData: Float32Array
  /** slot -> 记录，删除时才能 O(1) 找到要搬动的那一条 */
  slots: Array<Tracked | null>
}

interface Tracked {
  body: RAPIER.RigidBody
  bucket: Bucket
  slot: number
  scale: THREE.Vector3
}

// ============================================================
//  单位几何（box 与 ball 靠 instanceMatrix 缩放复用，
//  其余形状按尺寸分桶，因为非均匀缩放会让法线失真）
// ============================================================

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const UNIT_BALL = new THREE.SphereGeometry(1, 24, 16)

const DEFAULT_CAPACITY = 512

function shapeKey(shape: ShapeSpec): string {
  switch (shape.kind) {
    case 'box':
      return 'box'
    case 'ball':
      return 'ball'
    case 'capsule':
      return `capsule:${shape.radius}:${shape.height}`
    case 'cylinder':
      return `cylinder:${shape.radius}:${shape.height}:${shape.axis ?? 'y'}`
    case 'cone':
      return `cone:${shape.radius}:${shape.height}`
    case 'roundBox':
      return `roundBox:${shape.size.join(':')}:${shape.radius}`
    case 'convex':
      return `convex:${shape.id}`
    case 'phantom':
      return `phantom:${shape.size.join(':')}`
  }
}

/**
 * 碰撞体尺寸同样必须**每次现算**。
 *
 * 早先这里是 `ShapeDef.createCollider` —— 一个捕获了尺寸的闭包。因为 box / ball
 * 的 key 是固定字符串，闭包只按第一次调用时的尺寸构建：`addGround(60)` 先执行，
 * 于是后面每一块砖的碰撞体都成了 60×0.6×60 的巨型平板，117 个巨型碰撞体互相重叠，
 * 整面墙在开场第一帧就被炸到 90 米高空。
 * 改成纯函数后，这类"缓存污染"从结构上就不可能再发生。
 */
function colliderOf(shape: ShapeSpec): RAPIER.ColliderDesc {
  switch (shape.kind) {
    case 'box': {
      const [w, h, d] = shape.size
      return RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
    }

    case 'ball':
      return RAPIER.ColliderDesc.ball(shape.radius)

    case 'capsule': {
      // three 的 CapsuleGeometry 与 Rapier 的 capsule 定义不同，
      // 这里统一成"圆柱段半高 + 两端半球盖"
      const halfHeight = Math.max(0.001, shape.height / 2 - shape.radius)
      return RAPIER.ColliderDesc.capsule(halfHeight, shape.radius)
    }

    case 'cylinder': {
      const desc = RAPIER.ColliderDesc.cylinder(shape.height / 2, shape.radius)
      const axis = shape.axis ?? 'y'

      // Rapier 的圆柱轴固定在本地 y，靠碰撞体自身的旋转把它掰到目标轴向
      if (axis === 'x') {
        const q = Math.SQRT1_2
        desc.setRotation({ x: 0, y: 0, z: q, w: q })
      } else if (axis === 'z') {
        const q = Math.SQRT1_2
        desc.setRotation({ x: q, y: 0, z: 0, w: q })
      }

      return desc
    }

    case 'cone':
      return RAPIER.ColliderDesc.cone(shape.height / 2, shape.radius)

    case 'roundBox': {
      const [w, h, d] = shape.size
      const r = shape.radius
      return RAPIER.ColliderDesc.roundCuboid(
        Math.max(1e-4, w / 2 - r),
        Math.max(1e-4, h / 2 - r),
        Math.max(1e-4, d / 2 - r),
        r,
      )
    }

    case 'convex':
      return RAPIER.ColliderDesc.convexHull(shape.points) ?? RAPIER.ColliderDesc.ball(0.1)

    case 'phantom': {
      const [w, h, d] = shape.size
      return RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
    }
  }
}

/** 只负责"长什么样"。同一 key 的几何是共享的，尺寸不进缓存 */
function buildShapeDef(shape: ShapeSpec): ShapeDef {
  const key = shapeKey(shape)

  switch (shape.kind) {
    case 'box':
      return { key, geometry: UNIT_BOX }

    case 'ball':
      return { key, geometry: UNIT_BALL }

    case 'capsule': {
      const halfHeight = Math.max(0.001, shape.height / 2 - shape.radius)
      return { key, geometry: new THREE.CapsuleGeometry(shape.radius, halfHeight * 2, 10, 20) }
    }

    case 'cylinder': {
      const geometry = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.height, 28)

      // 几何也要跟着转，否则视觉和碰撞体会对不上
      if (shape.axis === 'x') geometry.rotateZ(Math.PI / 2)
      else if (shape.axis === 'z') geometry.rotateX(Math.PI / 2)

      return { key, geometry }
    }

    case 'cone':
      return { key, geometry: new THREE.ConeGeometry(shape.radius, shape.height, 28) }

    case 'roundBox': {
      const [w, h, d] = shape.size
      return { key, geometry: new RoundedBoxGeometry(w, h, d, 4, shape.radius) }
    }

    case 'convex': {
      const points = shape.points
      const vertices: THREE.Vector3[] = []
      for (let i = 0; i < points.length; i += 3) {
        vertices.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]))
      }
      return { key, geometry: new ConvexGeometry(vertices) }
    }

    case 'phantom':
      return { key, geometry: UNIT_BOX, invisible: true }
  }
}

// ============================================================
//  Stage：物理刚体 + 实例化渲染的桥
// ============================================================

/**
 * 展厅通过 Stage 创建物体，不需要关心 draw call。
 *
 * 相同形状的物体会归到同一个 InstancedMesh 桶里，
 * 每帧从 Rapier 读一次变换写进 instanceMatrix —— 5000 个盒子也只有 1 次 draw call。
 */
export class Stage {
  readonly group = new THREE.Group()

  private readonly buckets = new Map<string, Bucket>()
  private readonly defs = new Map<string, ShapeDef>()
  private readonly tracked: Tracked[] = []
  // 用 handle（数值）当 key，而不是 RigidBody 对象引用 ——
  // WASM 包装对象在不同 API 返回时可能是不同的 JS 实例，用对象做 key 会查不到
  private readonly byBody = new Map<number, Tracked>()
  /** 纯装饰物（地面网格线之类），不参与物理但要跟着 clear 一起清 */
  private readonly decorations: THREE.Object3D[] = []
  private readonly material: THREE.MeshStandardMaterial
  private readonly scratch = new THREE.Object3D()
  private readonly scratchColor = new THREE.Color()

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {
    // roughness 调高、metalness 压到接近 0：
    // 场景里没有环境贴图，metalness 一高就会出现大片突兀的蓝色高光斑
    this.material = new THREE.MeshStandardMaterial({
      roughness: 0.78,
      metalness: 0.04,
    })
    scene.add(this.group)
  }

  get objectCount(): number {
    return this.tracked.length
  }

  /**
   * 调试用：速度最快的前几个实例。
   * 哪个物体在乱飞、速度多少，一眼就能看出来 —— 比盯截图猜快得多。
   */
  getFastest(
    limit = 4,
  ): Array<{ speed: number; x: number; y: number; z: number; edge: number; mass: number }> {
    const rows: Array<{
      speed: number
      x: number
      y: number
      z: number
      edge: number
      mass: number
    }> = []

    for (const item of this.tracked) {
      const v = item.body.linvel()
      const t = item.body.translation()

      rows.push({
        speed: Math.hypot(v.x, v.y, v.z),
        x: t.x,
        y: t.y,
        z: t.z,
        edge: item.scale.x,
        mass: item.body.mass(),
      })
    }

    rows.sort((a, b) => b.speed - a.speed)
    return rows.slice(0, limit)
  }

  /** 调试用：当前所有实例的包围盒。maxY 骤降就说明东西塌了/飞了 */
  getBounds(): {
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
    count: number
  } {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity

    for (const item of this.tracked) {
      const t = item.body.translation()
      minX = Math.min(minX, t.x)
      maxX = Math.max(maxX, t.x)
      minY = Math.min(minY, t.y)
      maxY = Math.max(maxY, t.y)
      minZ = Math.min(minZ, t.z)
      maxZ = Math.max(maxZ, t.z)
    }

    return { minX, maxX, minY, maxY, minZ, maxZ, count: this.tracked.length }
  }

  get drawCalls(): number {
    let n = 0
    for (const bucket of this.buckets.values()) if (bucket.count > 0) n++
    return n
  }

  // ---------------- 创建 ----------------

  spawn(spec: BodySpec): RAPIER.RigidBody {
    const def = this.resolveShape(spec.shape)
    const scale = scaleOf(spec.shape)
    const bucket = this.getBucket(def)

    if (bucket.count >= bucket.capacity) this.growBucket(bucket)

    const slot = bucket.count++
    bucket.mesh.count = bucket.count

    // ---- 刚体 ----
    const kind = spec.kind ?? 'dynamic'
    const desc =
      kind === 'fixed'
        ? RAPIER.RigidBodyDesc.fixed()
        : kind === 'kinematicPosition'
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : kind === 'kinematicVelocity'
            ? RAPIER.RigidBodyDesc.kinematicVelocityBased()
            : RAPIER.RigidBodyDesc.dynamic()

    desc.setTranslation(spec.position[0], spec.position[1], spec.position[2])

    if (spec.rotation) {
      const [x, y, z, w] = spec.rotation
      desc.setRotation({ x, y, z, w })
    }
    if (spec.ccd) desc.setCcdEnabled(true)
    if (spec.noSleep) desc.setCanSleep(false)
    if (spec.linearDamping !== undefined) desc.setLinearDamping(spec.linearDamping)
    if (spec.angularDamping !== undefined) desc.setAngularDamping(spec.angularDamping)

    const body = this.physics.world.createRigidBody(desc)

    // ---- 碰撞体 ----
    const colliderDesc = colliderOf(spec.shape)
      .setDensity(spec.density ?? 1)
      .setRestitution(spec.restitution ?? 0.2)
      .setFriction(spec.friction ?? 0.8)

    // 传感器只报告事件，不参与接触求解
    if (spec.sensor) colliderDesc.setSensor(true)

    this.physics.world.createCollider(colliderDesc, body)

    // ---- 渲染登记 ----
    if (!def.invisible) {
      if (spec.color !== undefined) {
        this.scratchColor.set(spec.color)
        bucket.mesh.setColorAt(slot, this.scratchColor)
        bucket.colorData[slot * 3] = this.scratchColor.r
        bucket.colorData[slot * 3 + 1] = this.scratchColor.g
        bucket.colorData[slot * 3 + 2] = this.scratchColor.b
      }

      const item: Tracked = { body, bucket, slot, scale }
      this.tracked.push(item)
      this.byBody.set(body.handle, item)
      bucket.slots[slot] = item
    }

    return body
  }

  /** 一次创建一批同型物体，避免在循环里反复查表 */
  spawnMany(count: number, make: (index: number) => BodySpec): RAPIER.RigidBody[] {
    const out: RAPIER.RigidBody[] = []
    for (let i = 0; i < count; i++) out.push(this.spawn(make(i)))
    return out
  }

  /** 静态地面：一块大薄板 + 一层网格线（网格提供尺度感，没有它整个场景会像浮在空中） */
  addGround(size = 60, y = 0, color: THREE.ColorRepresentation = '#2b3550'): RAPIER.RigidBody {
    this.addGrid(size, y)

    return this.spawn({
      shape: { kind: 'box', size: [size, 0.6, size] },
      position: [0, y - 0.3, 0],
      kind: 'fixed',
      friction: 0.9,
      restitution: 0.05,
      color,
    })
  }

  /** 地面网格线，纯装饰、不参与物理 */
  private addGrid(size: number, y: number): void {
    // 让格子保持 1 米见方，尺寸变了密度也不会跟着变
    const divisions = Math.min(240, Math.max(20, Math.round(size)))

    // 网格是辅助线，不能比主体还抢眼 —— 低对比、低不透明度
    const grid = new THREE.GridHelper(size, divisions, 0x33405e, 0x222b42)
    grid.position.y = y + 0.02

    const material = grid.material as THREE.Material
    material.transparent = true
    material.opacity = 0.32
    material.depthWrite = false

    this.group.add(grid)
    this.decorations.push(grid)
  }

  /** 四面围墙，防止物体飞出去 */
  addArena(size = 30, height = 8): void {
    const half = size / 2
    const wall = (pos: [number, number, number], rot: [number, number, number, number]) => {
      this.spawn({
        shape: { kind: 'box', size: [size, height, 1] },
        position: pos,
        rotation: rot,
        kind: 'fixed',
        friction: 0.4,
        restitution: 0.3,
        color: '#232a3d',
      })
    }

    wall([0, height / 2, -half], [0, 0, 0, 1])
    wall([0, height / 2, half], [0, 0, 0, 1])
    wall([-half, height / 2, 0], [0, 0.7071068, 0, 0.7071068])
    wall([half, height / 2, 0], [0, 0.7071068, 0, 0.7071068])
  }

  // ---------------- 同步 ----------------

  sync(): void {
    for (const item of this.tracked) this.writeTransform(item)

    for (const bucket of this.buckets.values()) {
      if (bucket.count === 0) continue
      bucket.mesh.instanceMatrix.needsUpdate = true
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true
    }
  }

  /** 改一个实例的颜色（传感器触发时的反馈用） */
  setColor(body: RAPIER.RigidBody, color: THREE.ColorRepresentation): void {
    const item = this.byBody.get(body.handle)
    if (!item) return

    const bucket = item.bucket
    this.scratchColor.set(color)
    bucket.mesh.setColorAt(item.slot, this.scratchColor)
    bucket.colorData[item.slot * 3] = this.scratchColor.r
    bucket.colorData[item.slot * 3 + 1] = this.scratchColor.g
    bucket.colorData[item.slot * 3 + 2] = this.scratchColor.b

    if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true
  }

  /**
   * 移除一个刚体并回收它的实例槽位。
   *
   * 用 swap-remove：把桶里最后一个槽位搬到空出来的位置，
   * 于是 InstancedMesh 只需要把 count 减一，不用重建任何缓冲区。
   */
  remove(body: RAPIER.RigidBody): void {
    const handle = body.handle
    const item = this.byBody.get(handle)

    this.physics.world.removeRigidBody(body)
    if (!item) return

    this.byBody.delete(handle)

    const bucket = item.bucket
    const lastSlot = bucket.count - 1

    bucket.slots[item.slot] = null
    bucket.count -= 1
    bucket.mesh.count = bucket.count

    if (item.slot !== lastSlot) {
      const moved = bucket.slots[lastSlot]

      if (moved) {
        moved.slot = item.slot
        bucket.slots[item.slot] = moved

        const src = lastSlot * 3
        const dst = item.slot * 3
        bucket.colorData[dst] = bucket.colorData[src]
        bucket.colorData[dst + 1] = bucket.colorData[src + 1]
        bucket.colorData[dst + 2] = bucket.colorData[src + 2]

        // 立刻把变换补写到新槽位，否则这一帧会闪一下
        this.writeTransform(moved)

        if (bucket.mesh.instanceColor) {
          this.scratchColor.setRGB(
            bucket.colorData[dst],
            bucket.colorData[dst + 1],
            bucket.colorData[dst + 2],
          )
          bucket.mesh.setColorAt(moved.slot, this.scratchColor)
        }
      }
    }

    bucket.slots[lastSlot] = null

    const index = this.tracked.indexOf(item)
    if (index >= 0) {
      const last = this.tracked.pop()
      if (last && last !== item) this.tracked[index] = last
    }
  }

  private writeTransform(item: Tracked): void {
    const t = item.body.translation()
    const r = item.body.rotation()

    this.scratch.position.set(t.x, t.y, t.z)
    this.scratch.quaternion.set(r.x, r.y, r.z, r.w)
    this.scratch.scale.copy(item.scale)
    this.scratch.updateMatrix()

    item.bucket.mesh.setMatrixAt(item.slot, this.scratch.matrix)
  }

  // ---------------- 清理 ----------------

  clear(): void {
    for (const bucket of this.buckets.values()) {
      this.group.remove(bucket.mesh)
      bucket.mesh.dispose()
    }
    this.buckets.clear()
    this.defs.clear()
    this.tracked.length = 0
    this.byBody.clear()

    for (const item of this.decorations) {
      this.group.remove(item)

      const grid = item as THREE.GridHelper
      grid.geometry?.dispose()
      const material = grid.material as THREE.Material | undefined
      material?.dispose()
    }
    this.decorations.length = 0
  }

  // ---------------- 内部 ----------------

  private resolveShape(shape: ShapeSpec): ShapeDef {
    const key = shapeKey(shape)
    let def = this.defs.get(key)
    if (!def) {
      def = buildShapeDef(shape)
      this.defs.set(key, def)
    }
    return def
  }

  private getBucket(def: ShapeDef): Bucket {
    let bucket = this.buckets.get(def.key)
    if (bucket) return bucket

    const mesh = new THREE.InstancedMesh(def.geometry, this.material, DEFAULT_CAPACITY)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.castShadow = true
    mesh.receiveShadow = true
    // 实例在着色器里被四处搬运，包围球不可信
    mesh.frustumCulled = false

    bucket = {
      key: def.key,
      mesh,
      capacity: DEFAULT_CAPACITY,
      count: 0,
      colorData: new Float32Array(DEFAULT_CAPACITY * 3).fill(1),
      slots: new Array<Tracked | null>(DEFAULT_CAPACITY).fill(null),
    }

    this.group.add(mesh)
    this.buckets.set(def.key, bucket)
    return bucket
  }

  /** 桶满了就翻倍重建，并把已用的颜色重放回去 */
  private growBucket(bucket: Bucket): void {
    const capacity = bucket.capacity * 2
    const next = new THREE.InstancedMesh(bucket.mesh.geometry, this.material, capacity)
    next.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    next.count = bucket.count
    next.castShadow = true
    next.receiveShadow = true
    next.frustumCulled = false

    const colorData = new Float32Array(capacity * 3).fill(1)
    colorData.set(bucket.colorData.subarray(0, bucket.count * 3))
    next.instanceColor = new THREE.InstancedBufferAttribute(colorData, 3)

    this.group.remove(bucket.mesh)
    bucket.mesh.dispose()
    this.group.add(next)

    bucket.mesh = next
    bucket.capacity = capacity
    bucket.colorData = colorData

    // slot 表跟着一起扩
    while (bucket.slots.length < capacity) bucket.slots.push(null)
  }
}
