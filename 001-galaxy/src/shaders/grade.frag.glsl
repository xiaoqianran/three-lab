// 最终调色 pass：横向色差 + 暗角 + 胶片颗粒 + 轻微提亮
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uLift;

varying vec2 vUv;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 dir = uv - 0.5;
  float d = length(dir);

  // 色差：越靠边缘 RGB 分离越明显
  float amount = uAberration * d * d;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + dir * amount).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - dir * amount).b;

  // 暗角
  float vig = smoothstep(1.05, 0.28, d * 1.55);
  col *= mix(1.0, vig, uVignette);

  // 提亮（压黑底，让星点更"浮"出来）
  col += uLift * (1.0 - smoothstep(0.0, 0.85, d));

  // 颗粒
  float g = rand(uv * 1024.0 + fract(uTime) * 91.7) - 0.5;
  col += g * uGrain;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
