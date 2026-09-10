precision highp float;

varying vec3 vColor;
varying float vAlpha;
varying float vSoft;
varying float vSpike;
varying float vKeep;

void main() {
  // 伴星系只保留一部分粒子
  if (vKeep < 0.5) discard;

  vec2 c = gl_PointCoord - 0.5;

  // 硬边方块：演示早期用来暴露"每个粒子其实就是一个方形点"
  float square = step(max(abs(c.x), abs(c.y)), 0.5);

  // 柔边光点：用 gl_PointCoord 把方块裁成圆形，再叠一层光晕
  float d = length(c);
  float soft = 0.0;
  if (d <= 0.5) {
    float core = pow(1.0 - d * 2.0, 2.4);
    float halo = pow(1.0 - d, 3.0) * 0.35;
    soft = core + halo;
  }

  float energy = mix(square, soft, vSoft);

  // 十字衍射星芒：模拟望远镜支撑结构造成的光衍射，只出现在最亮的粒子上
  if (vSpike > 0.01) {
    float fallX = pow(max(0.0, 1.0 - abs(c.x) * 2.0), 1.6);
    float fallY = pow(max(0.0, 1.0 - abs(c.y) * 2.0), 1.6);
    float horizontal = exp(-abs(c.y) * 26.0) * fallX;
    float vertical = exp(-abs(c.x) * 26.0) * fallY;
    energy += (horizontal + vertical) * vSpike * 0.85;
  }

  if (energy <= 0.002) discard;

  gl_FragColor = vec4(vColor * energy, energy * vAlpha);
}
