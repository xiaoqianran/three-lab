precision highp float;

// 尘埃层：和恒星层共用 galaxy.vert.glsl，只换一套片元逻辑。
// 它不发光，而是"吃掉"背后的星光。
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;

  // 尘埃是弥漫的，边缘要比恒星更软
  float a = pow(1.0 - d * 2.0, 1.7) * vAlpha;
  if (a <= 0.002) discard;

  // 这个 pass 用 CustomBlending：src * 0 + dst * (1 - srcAlpha)
  // 所以只需要输出遮挡量，rgb 无关紧要。
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
