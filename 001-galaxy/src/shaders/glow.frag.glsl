// 星系核心光晕：一个始终朝向相机的加法混合圆盘
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFalloff;
uniform float uTime;

varying vec2 vUv;

void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;

  float a = pow(max(0.0, 1.0 - d), uFalloff);

  // 缓慢呼吸，避免死板
  float pulse = 1.0 + 0.06 * sin(uTime * 0.7);
  a *= pulse;

  gl_FragColor = vec4(uColor * a * uIntensity, a);
}
