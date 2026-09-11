import * as THREE from 'three'
import { createLabel } from '../core/Label'
import type { Chapter } from './types'

/**
 * 11 · 着色器：从 GLSL 开始
 *
 * 前面所有材质都是"用别人的着色器"。这一章开始自己写：
 *
 *   ShaderMaterial     自定义着色器，但 three 会帮你把常用变量准备好：
 *                      顶点里能用 position / uv / normal、modelViewMatrix、projectionMatrix；
 *                      片元里能用 gl_FragCoord。
 *   RawShaderMaterial  什么都自己声明，连 projectionMatrix 都要写 —— 只在需要完全控制时才用。
 *
 * 两个必须记住的点：
 *   1. 顶点着色器负责"把顶点放到哪里"，片元着色器负责"这个像素是什么颜色"。
 *      想在顶点之间传数据，用 varying（顶点着色器写入，片元着色器读取，中间自动插值）。
 *   2. ShaderMaterial 的输出**不会**自动做色调映射和颜色空间转换，
 *      想让颜色跟其他材质对得上，要在片元末尾手动 include 这两个 chunk。
 *
 * 最后还演示了 onBeforeCompile：不重写整个着色器，只往内置材质里"打补丁"。
 */

let waterUniforms: Record<string, THREE.IUniform> | null = null
let pointUniforms: Record<string, THREE.IUniform> | null = null
let scanUniform: THREE.IUniform | null = null
let shaderTime = 0
let points: THREE.Points | null = null

/**
 * onBeforeCompile 注入用的时间 uniform。
 * 它必须在模块级声明：着色器编译只发生一次，之后我们每帧改它的 value，
 * 如果每次都新建一个对象，着色器里拿到的还是旧的引用。
 */
const scanTime: THREE.IUniform = { value: 0 }

/** 顶点着色器：用三角函数把平面推成波浪 */
const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;

  // varying 会在三角形内部自动插值，片元里拿到的就是"这个像素处的值"
  varying float vHeight;
  varying vec2 vUv;

  void main() {
    vUv = uv;

    // 注意：这里改的是**局部坐标**。
    // PlaneGeometry 躺在 XY 平面上、法线朝 +Z，网格整体再转 -90° 放平，
    // 所以"沿局部 z 位移"在世界上就是"上下起伏"
    vec3 displaced = position;
    float wave = sin(position.x * 0.55 + uTime * 1.5) * cos(position.y * 0.55 + uTime * 0.9);
    wave += sin(length(position.xy) * 0.85 - uTime * 2.2) * 0.45;
    displaced.z += wave * uAmplitude;

    vHeight = wave;

    // 顶点着色器必须自己算出裁剪空间坐标
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

/** 片元着色器：按高度混色，再叠一层网格线 */
const WATER_FRAGMENT = /* glsl */ `
  uniform vec3 uColorDeep;
  uniform vec3 uColorCrest;

  varying float vHeight;
  varying vec2 vUv;

  void main() {
    // 把 -1~1 的波高映射到 0~1，方便当混色权重
    float t = clamp(vHeight * 0.5 + 0.5, 0.0, 1.0);
    vec3 color = mix(uColorDeep, uColorCrest, t);

    // fract 取小数部分：在 uv×40 的格子里，越靠近格子边界越亮 —— 这就是网格线
    vec2 grid = abs(fract(vUv * 40.0) - 0.5);
    float line = smoothstep(0.44, 0.5, max(grid.x, grid.y));
    color += line * 0.22;

    gl_FragColor = vec4(color, 1.0);

    // 让自定义颜色也走一遍引擎的色调映射与 sRGB 输出，跟其他材质才对得上
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** 点云顶点着色器：演示 gl_PointSize 与逐点属性 */
const POINT_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;

  varying float vGlow;

  void main() {
    vec3 moved = position;
    moved.y += sin(uTime * 1.6 + aPhase) * 1.2;

    vec4 mvPosition = modelViewMatrix * vec4(moved, 1.0);
    vGlow = 0.5 + 0.5 * sin(uTime * 2.0 + aPhase);

    // gl_PointSize 的单位是像素。
    // 除以 -mvPosition.z 就是透视缩放：越远的点越小
    gl_PointSize = aSize * uSize * uPixelRatio * (70.0 / -mvPosition.z) * (0.55 + vGlow * 0.9);
    gl_Position = projectionMatrix * mvPosition;
  }
`

/** 点云片元着色器：用 gl_PointCoord 把方块裁成柔和圆点 */
const POINT_FRAGMENT = /* glsl */ `
  varying float vGlow;

  void main() {
    // gl_PointCoord 是点内部的 0~1 坐标，用它算到中心的距离
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceToCenter > 0.5) discard;

    float alpha = smoothstep(0.5, 0.05, distanceToCenter);
    vec3 color = mix(vec3(0.32, 0.62, 1.0), vec3(1.0, 0.86, 0.5), vGlow);

    gl_FragColor = vec4(color, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export const shaders: Chapter = {
  id: '11-shaders',
  title: '着色器：从 GLSL 开始',
  summary:
    '自己写一个水面：顶点着色器把平面推成波浪并通过 varying 把波高传给片元，片元着色器按波高混色再加一层网格线。再来一团会呼吸的点云（用 gl_PointSize 做透视缩放、用 gl_PointCoord 把方点裁成圆点）。最后用 onBeforeCompile 往内置材质里注入一条扫描线。',
  apis: [
    'ShaderMaterial', 'RawShaderMaterial', 'vertexShader', 'fragmentShader', 'uniforms',
    'varying', 'attribute', 'gl_PointSize', 'gl_PointCoord', 'onBeforeCompile',
    'customProgramCacheKey', 'tonemapping_fragment', 'colorspace_fragment',
  ],
  files: ['src/chapters/11-shaders.ts', 'src/core/Label.ts'],
  camera: { radius: 32, theta: 0.36, phi: 1.02, target: [0, 3, 0] },

  build({ world, scene, renderer }) {
    world.grid(40, 40, -0.02)
    scene.add(new THREE.HemisphereLight(0x9dc0ff, 0x1b2a4a, 1.1))

    // ---------------------------------------------------------- 1. 波浪水面
    waterUniforms = {
      uTime: { value: 0 },
      uAmplitude: { value: 0.7 },
      uColorDeep: { value: new THREE.Color(0x061428) },
      uColorCrest: { value: new THREE.Color(0x4fd2ff) },
    }

    const water = new THREE.Mesh(
      // 分段数必须够高，顶点位移才有细节：80×80 已经有 6561 个顶点了
      new THREE.PlaneGeometry(34, 34, 160, 160),
      new THREE.ShaderMaterial({
        uniforms: waterUniforms,
        vertexShader: WATER_VERTEX,
        fragmentShader: WATER_FRAGMENT,
        side: THREE.DoubleSide,
        // 波浪起伏很大，开线框能直接看到顶点被推歪的样子
        wireframe: false,
      }),
    )
    water.rotation.x = -Math.PI / 2
    water.position.y = 1.1
    world.add(water)

    const waterLabel = createLabel('ShaderMaterial · 顶点位移波浪', { size: 0.6 })
    waterLabel.position.set(0, 5.4, -9)
    world.add(waterLabel)

    // ---------------------------------------------------------- 2. 点云
    const COUNT = 2600
    const positions = new Float32Array(COUNT * 3)
    const sizes = new Float32Array(COUNT)
    const phases = new Float32Array(COUNT)

    for (let i = 0; i < COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.sqrt(Math.random()) * 12
      positions[i * 3] = Math.cos(angle) * radius
      positions[i * 3 + 1] = 6 + Math.random() * 7
      positions[i * 3 + 2] = Math.sin(angle) * radius
      sizes[i] = 1.2 + Math.random() * 3.4
      phases[i] = Math.random() * Math.PI * 2
    }

    const pointGeometry = new THREE.BufferGeometry()
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    // 自定义 attribute：每个点的尺寸和相位各不相同，才能"各闪各的"
    pointGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    pointGeometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

    pointUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uSize: { value: 1 },
    }

    points = new THREE.Points(
      pointGeometry,
      new THREE.ShaderMaterial({
        uniforms: pointUniforms,
        vertexShader: POINT_VERTEX,
        fragmentShader: POINT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        // 加法混合：重叠的点会越叠越亮，很适合发光粒子
        blending: THREE.AdditiveBlending,
      }),
    )
    world.add(points)

    const pointLabel = createLabel('ShaderMaterial · 点云 / gl_PointSize', { size: 0.6 })
    pointLabel.position.set(0, 14.6, 0)
    world.add(pointLabel)

    // ---------------------------------------------------------- 3. onBeforeCompile
    // 不想重写整个着色器？可以在内置材质编译前拿到它的 shader 字符串，
    // 做字符串替换来"打补丁"。这样光照、阴影、雾全都不用自己写。
    scanUniform = { value: 1.0 }

    const scanMaterial = new THREE.MeshStandardMaterial({ color: 0x6fa8ff, roughness: 0.34, metalness: 0.35 })
    scanMaterial.onBeforeCompile = (shader) => {
      // 把自定义 uniform 挂进 three 的 uniform 表里
      shader.uniforms.uTime = scanTime
      shader.uniforms.uScan = scanUniform!

      // 1) 先声明新 uniform（跟在 <common> 后面）
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uScan;`,
      )

      // 2) 再在"颜色已经算完"的位置插进去。
      //    <color_fragment> 之后 diffuseColor 就是最终基础色，
      //    在这里乘一层扫描线最省事。
      //    gl_FragCoord 是屏幕坐标，任何片元着色器里都能直接用
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float scan = 0.74 + 0.26 * sin(gl_FragCoord.y * 0.32 + uTime * 3.0);
         diffuseColor.rgb *= mix(1.0, scan, uScan);`,
      )
    }
    // 同一个内置材质类型 + 不同的 onBeforeCompile 会撞到同一份着色器缓存，
    // 用 cacheKey 把它们区分开
    scanMaterial.customProgramCacheKey = () => 'scanline-11'

    const scanGroup = new THREE.Group()
    const scanPositions: Array<[number, number, number]> = [
      [-13, 2.4, -13],
      [0, 2.6, -15],
      [13, 2.4, -13],
    ]
    for (const [x, y, z] of scanPositions) {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.5, 48, 32), scanMaterial)
      sphere.position.set(x, y, z)
      sphere.castShadow = true
      scanGroup.add(sphere)
    }
    world.add(scanGroup)

    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(8, 14, 6)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -22
    key.shadow.camera.right = 22
    key.shadow.camera.top = 22
    key.shadow.camera.bottom = -22
    key.shadow.camera.far = 60
    key.shadow.camera.updateProjectionMatrix()
    scene.add(key)

    const scanLabel = createLabel('onBeforeCompile · 给内置材质打补丁', { size: 0.55 })
    scanLabel.position.set(0, 6.2, -14)
    world.add(scanLabel)

    // 分辨率变了要同步给点云着色器，否则点的大小会不对
    world.onResize(() => {
      if (pointUniforms) pointUniforms.uPixelRatio.value = renderer.getPixelRatio()
    })

    // ---------------------------------------------------------- 面板
    const params = { 波高: 0.7, 深渊色: '#061428', 浪尖色: '#4fd2ff', 点大小: 1, 扫描线: 1 }
    const folder = world.folder('第 11 章')
    folder
      .add(params, '波高', 0, 2.2, 0.02)
      .name('波高 uAmplitude')
      .onChange((v: number) => {
        if (waterUniforms) waterUniforms.uAmplitude.value = v
      })
    folder
      .addColor(params, '深渊色')
      .name('uColorDeep')
      .onChange((hex: string) => {
        if (waterUniforms) (waterUniforms.uColorDeep.value as THREE.Color).set(hex)
      })
    folder
      .addColor(params, '浪尖色')
      .name('uColorCrest')
      .onChange((hex: string) => {
        if (waterUniforms) (waterUniforms.uColorCrest.value as THREE.Color).set(hex)
      })
    folder
      .add(params, '点大小', 0.2, 3, 0.05)
      .name('点云尺寸 uSize')
      .onChange((v: number) => {
        // 改的是 uniform，不是 scale —— 缩放 Points 会把点的位置也一起放大
        if (pointUniforms) pointUniforms.uSize.value = v
      })
    folder
      .add(params, '扫描线', 0, 1, 0.01)
      .name('扫描线强度 uScan')
      .onChange((v: number) => {
        if (scanUniform) scanUniform.value = v
      })
    folder.add({ 显示点云: true }, '显示点云').onChange((v: boolean) => {
      if (points) points.visible = v
    })
  },

  update(dt) {
    // 着色器里的时间是一个普通 uniform，由我们每帧推进 —— 它和"世界的时间"完全同步
    shaderTime += dt

    if (waterUniforms) waterUniforms.uTime.value = shaderTime
    if (pointUniforms) pointUniforms.uTime.value = shaderTime

    // onBeforeCompile 里注入的 uniform 是同一个对象引用，直接改 value 就能生效
    scanTime.value = shaderTime
  },

  dispose() {
    // ShaderMaterial 的 uniforms 是我们自己持有的对象，切章时一并放下
    waterUniforms = null
    pointUniforms = null
    scanUniform = null
    points = null
    shaderTime = 0
  },
}
