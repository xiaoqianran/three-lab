/**
 * 分步演示的剧本。
 *
 * 每个步骤不直接描述"画面长什么样"，而是描述"这一层能力开启到什么程度"。
 * 控制器会把当前权重平滑地推向目标权重，于是相邻两步之间是连续演化，
 * 而不是硬切换 —— 这就是"动画感"的来源。
 */

export interface StageState {
  /** 星系粒子整体显隐 */
  opacity: number
  /** 0 = 相位均匀随机（一团云），1 = 聚束成对数螺旋旋臂 */
  armBlend: number
  /** 盘面厚度展开程度 */
  thickness: number
  /** 自转开关（CPU 累积旋转相位，所以可以是 0） */
  spin: number
  /** curl noise 湍流强度 */
  noise: number
  /** 0 = 单色白点，1 = 按半径分级着色 + 闪烁 + 尺寸差异 */
  color: number
  /** 0 = 硬边方块，1 = 柔边光点 */
  soft: number
  /** 恒星年龄分层：核球老黄星 / 旋臂年轻蓝星 / 少量 HII 红区 */
  age: number
  /** 亮星的十字衍射星芒 */
  spike: number
  /** 旋臂内侧的暗尘埃带（独立的一层减法混合粒子） */
  dust: number
  /** 鼠标引力扰动 */
  pointer: number
  /** 旋臂上的超新星爆发 */
  supernova: number
  /** 卫星星系与潮汐尾 */
  satellite: number
  /** 星系碰撞（伴星系掠过） */
  collision: number
  /** 形态：0 = 坍缩前的球状气体云，1 = 已成盘的旋臂结构（默认为 1） */
  collapse: number
  /** 时间倒流：0 = 正放，1 = 倒放（过渡中途会自然经过静止） */
  reverse: number
  /** 景深散景 */
  dof: number
  /** 背景星空 */
  starfield: number
  /** 星系核心光晕 */
  core: number
  /** 泛光 */
  bloom: number
  /** 色差 / 暗角 / 颗粒 */
  grade: number
  /** lil-gui 控制面板 */
  gui: number
}

export const STAGE_KEYS = [
  'opacity',
  'armBlend',
  'thickness',
  'spin',
  'noise',
  'color',
  'soft',
  'age',
  'spike',
  'dust',
  'pointer',
  'supernova',
  'satellite',
  'collision',
  'collapse',
  'reverse',
  'dof',
  'starfield',
  'core',
  'bloom',
  'grade',
  'gui',
] as const satisfies readonly (keyof StageState)[]

/** 进入演示前的起点：什么都没有 */
export const INITIAL_STATE: StageState = {
  opacity: 0,
  armBlend: 0,
  thickness: 0,
  spin: 0,
  noise: 0,
  color: 0,
  soft: 0,
  age: 0,
  spike: 0,
  dust: 0,
  pointer: 0,
  supernova: 0,
  satellite: 0,
  collision: 0,
  // 形态不是"要不要显示"的开关，而是一个形态参数，起点就是成盘的
  collapse: 1,
  reverse: 0,
  dof: 0,
  starfield: 0,
  core: 0,
  bloom: 0,
  grade: 0,
  gui: 0,
}

export interface CameraPose {
  radius: number
  theta: number
  phi: number
}

export interface TourStep {
  title: string
  /** 一句话点出这一步解决了什么问题 */
  desc: string
  /** 这一步落地的文件 */
  files: string[]
  camera: CameraPose
  /** 自动播放时在本步停留的秒数 */
  duration: number
  /** 相对上一步新增/改变的权重（补丁） */
  state: Partial<StageState>
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: '搭建骨架',
    desc: '先别管星系。让浏览器能跑 three.js：一块 canvas、一个渲染器、一个场景、一个相机，加一个每帧调用 render 的主循环。此刻画面是空的 —— 但管线已经通了。',
    files: ['index.html', 'src/core/Engine.ts', 'src/main.ts'],
    camera: { radius: 26, theta: 0.6, phi: 1.18 },
    duration: 3.4,
    state: {},
  },
  {
    title: '一团随机粒子',
    desc: '把几十万个点塞进 BufferGeometry，交给 Points 画出来。位置全部随机，什么都看不出来，但证明了「海量顶点」这件事本身跑得动。',
    files: ['src/scene/Galaxy.ts'],
    camera: { radius: 24, theta: 0.95, phi: 1.02 },
    duration: 3.8,
    state: { opacity: 1, thickness: 0.5 },
  },
  {
    title: '排成螺旋',
    desc: '关键一步：把每个粒子的相位从「均匀随机」改成「对数螺旋 + 少量高斯抖动」。半径不变、只挪角度，于是随机云原地收缩成了旋臂。',
    files: ['src/scene/Galaxy.ts', 'src/shaders/galaxy.vert.glsl'],
    camera: { radius: 21, theta: 1.3, phi: 0.92 },
    duration: 4.4,
    state: { armBlend: 1, thickness: 1 },
  },
  {
    title: '让它转起来',
    desc: 'CPU 每帧改 26 万个坐标是扛不住的。改成把时间传进顶点着色器，让 GPU 自己算旋转；而且角速度随半径递减 —— 内圈快、外圈慢，这就是差速自转。',
    files: ['src/shaders/galaxy.vert.glsl', 'src/core/Engine.ts'],
    camera: { radius: 18, theta: 1.75, phi: 0.98 },
    duration: 4.6,
    state: { spin: 1 },
  },
  {
    title: '气体湍流',
    desc: '纯旋转太机械。叠一层 curl noise：对 Simplex 噪声场求旋度，得到一个无散度的流场，粒子顺着它飘，就有了星云那种被搅动的质感。外圈扰动更强。',
    files: ['src/shaders/galaxy.vert.glsl'],
    camera: { radius: 15, theta: 2.15, phi: 0.88 },
    duration: 4.4,
    state: { noise: 1 },
  },
  {
    title: '颜色与质感',
    desc: '同一时刻做三件事：按半径分级着色（核球炽白 → 旋臂青蓝 → 外缘橙红）、加上明暗闪烁与尺寸差异，再把方形点用 gl_PointCoord 裁成柔边光点。',
    files: ['src/shaders/galaxy.vert.glsl', 'src/shaders/galaxy.frag.glsl'],
    camera: { radius: 13, theta: 2.6, phi: 0.82 },
    duration: 4.6,
    state: { color: 1, soft: 1 },
  },
  {
    title: '相机交互',
    desc: '用球坐标描述相机位置：拖动改水平角和俯仰角，滚轮改半径，每帧再阻尼插值过去。现在试着拖一下画面 —— 阻尼公式 1 - exp(-k·dt) 与帧率无关，所以手感很稳。',
    files: ['src/core/CameraRig.ts'],
    camera: { radius: 22, theta: 3.0, phi: 1.12 },
    duration: 5.5,
    state: {},
  },
  {
    title: '背景星空',
    desc: '星系不该悬在纯黑里。用球面均匀采样撒一层远景恒星，按色温随机着色。它们不参与任何模拟，只负责把空间感撑开。',
    files: ['src/scene/Starfield.ts'],
    camera: { radius: 27, theta: 3.45, phi: 1.16 },
    duration: 3.8,
    state: { starfield: 1 },
  },
  {
    title: '核心光晕',
    desc: '星系中心该是炽热的核球。用一个永远正对相机的平面（billboard），画一个径向渐变的加法光斑，再叠一点呼吸动画避免死板。',
    files: ['src/scene/CoreGlow.ts', 'src/shaders/glow.frag.glsl'],
    camera: { radius: 17, theta: 3.9, phi: 0.9 },
    duration: 3.8,
    state: { core: 1 },
  },
  {
    title: '后处理',
    desc: '直接渲染出来的画面偏"干"。把渲染结果当纹理，串一条 pass 链：泛光让亮部溢出 → 色差让边缘 RGB 分离 → 暗角收边 → 颗粒加胶片味，最后由 OutputPass 统一做色调映射与 sRGB 输出。',
    files: ['src/scene/PostFX.ts', 'src/shaders/grade.frag.glsl'],
    camera: { radius: 21, theta: 4.35, phi: 0.96 },
    duration: 4.6,
    state: { bloom: 1, grade: 1 },
  },
  {
    title: '控制面板',
    desc: '所有 magic number 都该能实时调。lil-gui 把参数接出来：拖动时实时生效的走 onChange，需要重新生成粒子的走 onFinishChange（否则拖动过程中会疯狂重建）。',
    files: ['src/ui/Panel.ts'],
    camera: { radius: 19, theta: 4.8, phi: 1.04 },
    duration: 4.4,
    state: { gui: 1 },
  },
  {
    title: '恒星年龄分层',
    desc: '真实星系里恒星不是同一种颜色，而是按年龄分层：核球和晕是年老的黄红色恒星，旋臂上则是刚诞生的蓝白色年轻恒星团，还夹杂着少量被年轻恒星电离的红色 HII 区。',
    files: ['src/scene/Galaxy.ts', 'src/shaders/galaxy.vert.glsl'],
    camera: { radius: 15, theta: 5.7, phi: 0.86 },
    duration: 4.6,
    state: { age: 1 },
  },
  {
    title: '衍射星芒',
    desc: '望远镜拍到的亮星都带着十字光芒 —— 那是光经过支撑结构产生的衍射。给最亮的那批粒子在片元着色器里画上星芒，画面立刻从"渲染出来的"变成"拍出来的"。',
    files: ['src/shaders/galaxy.frag.glsl'],
    camera: { radius: 11, theta: 6.15, phi: 0.78 },
    duration: 4.4,
    state: { spike: 1 },
  },
  {
    title: '尘埃带',
    desc: '这一层是反向的：它不发光，而是吸收光。用第二层粒子配 CustomBlending（dst × (1 − srcAlpha)）叠在旋臂内侧，把背后的星光吃掉，于是旋臂出现暗带，核球也被部分遮蔽 —— 这是"像真实星系"最关键的一步。',
    files: ['src/scene/Galaxy.ts', 'src/shaders/dust.frag.glsl'],
    camera: { radius: 17, theta: 6.6, phi: 0.98 },
    duration: 5,
    state: { dust: 1 },
  },
  {
    title: '交互引力源',
    desc: '把光标的位置反投影到星系盘面，当成一个引力中心传进着色器 —— 粒子会按反平方距离被拽过去，拉出旋臂、甩出潮汐尾。按住鼠标右键拖动试试，松手即恢复。',
    files: ['src/main.ts', 'src/shaders/galaxy.vert.glsl'],
    camera: { radius: 20, theta: 7.05, phi: 0.92 },
    duration: 9,
    state: { pointer: 1 },
  },
  {
    title: '超新星',
    desc: '大质量恒星死亡时会以接近光速的激波炸开。用一个小小的闪光池（6 个槽位）随机在旋臂上引爆，一圈波前扫过邻近粒子把它们照亮，然后迅速衰减 —— 这是整个星系里最短暂的事件。',
    files: ['src/shaders/galaxy.vert.glsl', 'src/main.ts'],
    camera: { radius: 16, theta: 7.5, phi: 0.9 },
    duration: 5.6,
    state: { supernova: 1 },
  },
  {
    title: '卫星星系与潮汐尾',
    desc: '主星系从不孤单。一个矮星系沿偏心轨道绕着它转，每次掠过近星点都会被潮汐力撕下一部分物质 —— 这些物质留在轨道后方，拉出一条又细又长的潮汐尾。',
    files: ['src/scene/Satellite.ts', 'src/shaders/satellite.vert.glsl'],
    camera: { radius: 34, theta: 8.4, phi: 0.94 },
    duration: 6.2,
    state: { satellite: 1 },
  },
  {
    title: '星系碰撞',
    desc: '宇宙里最壮观的尺度事件。一个伴星系高速掠过，两个星系的引力中心互相拉扯对方的粒子 —— 恒星不会被撞上，但整盘的形状会被扭曲，中间拉出物质桥，外侧甩出反尾。',
    files: ['src/shaders/galaxy.vert.glsl', 'src/main.ts'],
    camera: { radius: 40, theta: 8.85, phi: 0.86 },
    duration: 8,
    state: { collision: 1 },
  },
  {
    title: '时间倒流与形态演化',
    desc: '把时间倒着走会看到什么？转速先降到零、再反向；继续往回退，旋臂会解开、盘面会散掉，星系退回成它出生前的那团球状气体云 —— 这些粒子本来就是从同一批数据算出来的，只是换了一个形态参数。',
    files: ['src/shaders/galaxy.vert.glsl', 'src/tour/Tour.ts'],
    camera: { radius: 38, theta: 9.75, phi: 0.8 },
    duration: 7,
    state: { collapse: 0, reverse: 1 },
  },
  {
    title: '景深',
    desc: '真实望远镜拍下来的星系，只有焦平面附近是锐利的。粒子不写深度缓冲，走不了常规的 DoF 后处理，所以按"到焦平面的距离"在顶点阶段做近似：越失焦的点越大越淡，等效于散景。',
    files: ['src/shaders/galaxy.vert.glsl'],
    camera: { radius: 14, theta: 10.2, phi: 0.88 },
    duration: 5.4,
    state: { collapse: 1, reverse: 0, dof: 1 },
  },
  {
    title: '自由探索',
    desc: '全部能力已就位。拖拽旋转、滚轮穿越、空格自动巡游、面板实时调参 —— 试试把旋臂数量改成 4、把流场扰动拉满，或者把粒子数推到 120 万。',
    files: ['全部'],
    camera: { radius: 22, theta: 10.65, phi: 1.0 },
    duration: 7,
    state: {},
  },
]

/** 把第 0..index 步的补丁依次叠加，得到该步的完整目标状态 */
export function accumulateTo(index: number): StageState {
  const last = TOUR_STEPS.length - 1
  const out: StageState = { ...INITIAL_STATE }
  for (let i = 0; i <= Math.min(index, last); i++) {
    Object.assign(out, TOUR_STEPS[i].state)
  }
  return out
}

/** 所有步骤全部叠加后的最终状态（演示结束后就停在这里） */
export const FINAL_STATE: StageState = accumulateTo(TOUR_STEPS.length - 1)
