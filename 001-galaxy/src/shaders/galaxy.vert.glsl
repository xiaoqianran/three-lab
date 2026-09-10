// ============================================================
//  Spiral Galaxy - vertex stage
//
//  粒子位置完全由 GPU 解析计算，CPU 每帧只更新少量 uniform。
//
//  形态由三组能力叠加而成，每组都带一个 0~1 的权重，
//  由分步演示控制器平滑驱动 —— 这就是"逐步长出来"的实现方式：
//    1. 相位：均匀随机  <->  对数螺旋聚束      (uArmBlend)
//    2. 自转：静止      <->  差速自转          (uSpinPhase 累积)
//    3. 湍流：无        <->  curl noise 流场   (uNoiseBlend)
// ============================================================

// 超新星闪光池容量（需与 CPU 侧 FLASH_COUNT 保持一致）
#define FLASH_COUNT 6

uniform float uAnimTime;   // 噪声演化与闪烁用的时间
uniform float uSpinPhase;  // 累积的旋转相位（可暂停，所以不能用真实时间）
uniform float uRadius;
uniform float uSpin;
uniform float uShear;
uniform float uNoiseFreq;
uniform float uNoiseAmp;
uniform float uNoiseSpeed;
uniform float uSize;
uniform float uPixelRatio;
uniform float uBrightness;
uniform vec3 uColorCore;
uniform vec3 uColorMid;
uniform vec3 uColorEdge;

// ---- 分步演示权重 ----
uniform float uOpacity;
uniform float uArmBlend;
uniform float uThicknessBlend;
uniform float uNoiseBlend;
uniform float uColorBlend;
uniform float uSoftBlend;
uniform float uAgeBlend;
uniform float uSpike;

// 尘埃层复用同一份几何体与顶点着色器，靠这两项把它错开成"旋臂内侧的暗带"
uniform float uPhaseOffset;
uniform float uThicknessScale;

// ---- 鼠标引力扰动 ----
uniform vec3 uPointerPos;
uniform float uPointerStrength;
uniform float uPointerRadius;

// ---- 超新星闪光池 ----
uniform vec3 uFlashPos[FLASH_COUNT];
uniform float uFlashAge[FLASH_COUNT];
uniform float uFlashStrength;

// ---- 星系碰撞：整体平移 / 对方引力中心 / 潮汐强度 ----
uniform vec3 uBodyOffset;
uniform vec3 uOtherCenter;
uniform float uTidalStrength;
/** 这个星系只保留多少比例的粒子（伴星系取小值以省开销） */
uniform float uParticleKeep;

// ---- 形态演化：0 = 坍缩前的球状气体云，1 = 已成盘的旋臂结构 ----
uniform float uCollapseBlend;

// ---- 景深散景近似：失焦的粒子会变大变淡 ----
uniform float uFocusDistance;
uniform float uDofStrength;

attribute float aSize;
attribute float aSeed;
attribute float aRandomAngle;
attribute float aAge;

varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
varying float vSpike;
varying float vKeep;

// ------------------------------------------------------------
// Simplex 3D Noise - Ian McEwan, Ashima Arts (MIT)
// ------------------------------------------------------------
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
      i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
      i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// 近似旋度：对噪声场做有限差分，得到无散度的向量场
vec3 curlNoise(vec3 p) {
  const float e = 0.14;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  float x0 = snoise(p - dx);
  float x1 = snoise(p + dx);
  float y0 = snoise(p - dy);
  float y1 = snoise(p + dy);
  float z0 = snoise(p - dz);
  float z1 = snoise(p + dz);

  return vec3(
    (y1 - y0) - (z1 - z0),
    (z1 - z0) - (x1 - x0),
    (x1 - x0) - (y1 - y0)
  ) * 0.5;
}

void main() {
  float r = max(length(position.xz), 0.001);
  float rn = clamp(r / uRadius, 0.0, 1.0);

  // ---- 形态：均匀随机相位 与 旋臂相位之间走最短弧插值 ----
  // 半径和高度两套完全相同，只有角度不同，所以过渡看起来就是
  // "同一团粒子原地收拢成旋臂"。
  float delta = atan(position.z, position.x) - aRandomAngle;
  delta -= 6.28318530718 * floor(delta / 6.28318530718 + 0.5);
  float a0 = aRandomAngle + delta * uArmBlend + uPhaseOffset;

  // ---- 差速自转：内圈角速度大，外圈小 ----
  float omega = uSpin * (1.0 + uShear / (rn * 3.2 + 1.0));
  float ang = a0 + omega * uSpinPhase;

  vec3 discPos = vec3(cos(ang) * r, position.y * uThicknessBlend * uThicknessScale, sin(ang) * r);

  // ---- 坍缩前身：各向同性的弥散气体云 ----
  // 用 aSeed 导出球坐标，和盘面位置共用同一批粒子，靠 uCollapseBlend 插值
  float spherePhi = aRandomAngle;
  float sphereCos = aSeed * 2.0 - 1.0;
  float sphereSin = sqrt(max(0.0, 1.0 - sphereCos * sphereCos));
  vec3 sphereDir = vec3(sphereSin * cos(spherePhi), sphereCos, sphereSin * sin(spherePhi));
  float sphereR = pow(fract(aSeed * 7.13 + 0.37), 0.45) * uRadius * 1.55;

  vec3 pos = mix(sphereDir * sphereR, discPos, uCollapseBlend);

  // ---- 盘面翘曲：只有成盘之后才有意义 ----
  pos.y += sin(ang * 2.0 + aSeed * 6.2831) * r * 0.035 * (0.3 + rn) * uArmBlend * uCollapseBlend;

  // ---- curl noise 湍流：外圈扰动更强 ----
  vec3 np = pos * uNoiseFreq + vec3(0.0, uAnimTime * uNoiseSpeed, aSeed * 12.0);
  vec3 turb = curlNoise(np);
  pos += turb * uNoiseAmp * (0.35 + rn * 1.35) * uNoiseBlend;

  // ---- 星系整体平移（伴星系用它飞到另一侧） ----
  vec3 worldPos = pos + uBodyOffset;

  // ---- 鼠标引力扰动：右键按住时光标变成一个引力源 ----
  if (uPointerStrength > 0.001) {
    vec3 toPointer = uPointerPos - worldPos;
    float pd = length(toPointer);
    float within = smoothstep(uPointerRadius, 0.0, pd);
    float pull = uPointerStrength / (pd * pd * 0.35 + 1.0);
    worldPos += normalize(toPointer + vec3(0.0001)) * pull * within;
  }

  // ---- 潮汐拉扯：被另一个星系的引力中心拽过去 ----
  if (uTidalStrength > 0.001) {
    vec3 toOther = uOtherCenter - worldPos;
    float od = length(toOther);
    float pull = min(uTidalStrength / (od * od * 0.06 + 1.0), 5.0);
    worldPos += normalize(toOther + vec3(0.0001)) * pull;
  }

  // ---- 颜色：核球炽白 -> 旋臂青蓝 -> 外缘橙红 ----
  vec3 gradient = mix(uColorCore, uColorMid, smoothstep(0.0, 0.5, rn));
  gradient = mix(gradient, uColorEdge, smoothstep(0.42, 1.0, rn));

  // ---- 年龄分层：核球/晕 = 年老黄星，旋臂 = 年轻蓝星，少量 HII 红区 ----
  float isHII = step(0.972, fract(aSeed * 31.7));
  vec3 youngStar = mix(vec3(0.62, 0.78, 1.05), vec3(1.0, 0.3, 0.36), isHII);
  vec3 agedStar = mix(vec3(1.0, 0.8, 0.52), youngStar, aAge);
  gradient = mix(gradient, agedStar, uAgeBlend);

  // 着色能力未开启时退回单色白点
  vec3 col = mix(vec3(1.0), gradient, uColorBlend);

  float falloff = 1.0 - rn * 0.55 * uColorBlend;
  float twinkle = mix(
    1.0,
    0.78 + 0.22 * sin(uAnimTime * (1.4 + aSeed * 7.0) + aSeed * 62.83),
    uColorBlend
  );

  // ---- 超新星：一圈扩散的波前扫过邻近粒子 ----
  float flash = 0.0;
  if (uFlashStrength > 0.001) {
    for (int i = 0; i < FLASH_COUNT; i++) {
      float age = uFlashAge[i];
      // 无分支地屏蔽失效的闪光（age 落在 [0,1] 之外即失效）
      float valid = step(0.0, age) * (1.0 - step(1.0, age));
      float fd = distance(pos, uFlashPos[i]);
      float t = (fd - age * 5.0) * 0.85;
      float decay = (1.0 - age) * (1.0 - age);
      flash += exp(-t * t) * decay * valid;
    }
    flash *= uFlashStrength;
  }

  // 演示早期还没有颜色分级，压暗一点免得几十万个白点糊成一片过曝
  vColor = col * uBrightness * falloff * twinkle * mix(0.3, 1.0, uColorBlend) * uOpacity
    + vec3(0.72, 0.86, 1.0) * flash;
  vAlpha = min(
    1.0,
    mix(0.4, mix(0.95, 0.28, rn * rn), uColorBlend) * (0.65 + 0.35 * aSeed) * uOpacity + flash * 0.7
  );
  vSoft = uSoftBlend;
  // 只有又大又亮的粒子才带星芒，并且在配色开启之后才出现
  vSpike = uSpike * smoothstep(1.7, 3.2, aSize) * uColorBlend;
  // 伴星系只取一小部分粒子，省一半以上开销
  vKeep = step(aSeed, uParticleKeep);

  vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
  gl_Position = projectionMatrix * mvPos;

  float dist = max(-mvPos.z, 0.001);
  // 早期阶段粒子还没有尺寸差异，统一放大一点才看得清"点"本身
  float sizeMul = mix(3.2, aSize, uColorBlend);

  // ---- 景深：失焦的粒子变大、变淡，等效于相机散景 ----
  // 粒子不写深度缓冲，真正的 DoF 后处理拿不到距离，
  // 所以直接在顶点阶段按"到焦平面的距离"做近似。
  float coc = 0.0;
  if (uDofStrength > 0.001) {
    coc = clamp(abs(dist - uFocusDistance) / max(uFocusDistance, 0.001), 0.0, 1.0) * uDofStrength;
    vAlpha *= mix(1.0, 0.35, coc);
  }

  // 带星芒的亮星再放大一点，否则光芒没有伸展空间
  float spikeBoost = 1.0 + vSpike * 0.9;

  gl_PointSize = clamp(
    uSize * sizeMul * uPixelRatio * (240.0 / dist) * spikeBoost * (1.0 + coc * 2.2),
    1.0,
    96.0
  );
}
