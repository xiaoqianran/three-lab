// ============================================================
//  卫星星系 + 潮汐尾
//
//  一个矮星系沿偏心轨道绕主星系运行，被潮汐力撕出一条长尾。
//  这里不做真正的动力学积分 —— 把结果直接建模成
//  "球状核心 + 沿轨道切线向后拖出的细长尾巴"，视觉上等价，
//  而且完全跑在 GPU 上，不需要维护任何状态。
// ============================================================

uniform float uSatPhase;
uniform float uSatOrbitRadius;
uniform float uSatEcc;
uniform float uSatTilt;
uniform float uSatOpacity;
uniform float uSatSize;
uniform float uPixelRatio;
uniform float uTime;
uniform vec3 uColorCore;
uniform vec3 uColorTail;

attribute vec3 aTail;
attribute float aSize;
attribute float aSeed;

varying vec3 vColor;
varying float vAlpha;

/** 尾巴长度（世界单位），与 CPU 侧的生成范围保持一致 */
const float TAIL_LENGTH = 8.0;

void main() {
  // ---- 卫星本体在偏心轨道上的位置 ----
  float th = uSatPhase;
  float cosTh = cos(th);
  float orbitR = uSatOrbitRadius * (1.0 - uSatEcc * uSatEcc) / (1.0 + uSatEcc * cosTh);

  vec3 center = vec3(cosTh * orbitR, 0.0, sin(th) * orbitR);

  // 局部坐标系：tangent 沿轨道切线，radial 沿径向
  vec3 tangent = vec3(-sin(th), 0.0, cosTh);
  vec3 radial = vec3(cosTh, 0.0, sin(th));

  // 尾巴往运动的反方向拖
  vec3 pos = center + tangent * aTail.x + radial * aTail.y + vec3(0.0, aTail.z, 0.0);

  // 0 = 本体核心，1 = 尾端
  float tail = clamp(-aTail.x / TAIL_LENGTH, 0.0, 1.0);

  // 给尾巴一点湍流，否则太规整
  float swirl = sin(aTail.x * 0.85 + uTime * 0.3 + aSeed * 6.283) * 0.4 * tail;
  pos += vec3(0.0, swirl, 0.0);
  pos += radial * sin(aTail.x * 0.5 + uTime * 0.2 + aSeed * 3.1) * 0.3 * tail;

  // ---- 轨道面倾斜，避免整条轨迹躺在同一个平面里 ----
  float ct = cos(uSatTilt);
  float st = sin(uSatTilt);
  pos = vec3(pos.x, pos.y * ct - pos.z * st, pos.y * st + pos.z * ct);

  vColor = mix(uColorCore, uColorTail, tail * 0.85);
  vAlpha = (1.0 - tail * 0.72) * uSatOpacity * (0.6 + 0.4 * aSeed);

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPos;

  float dist = max(-mvPos.z, 0.001);
  float sizeMul = mix(1.0, aSize, 1.0 - tail * 0.65);

  gl_PointSize = clamp(uSatSize * sizeMul * uPixelRatio * (240.0 / dist), 0.8, 34.0);
}
