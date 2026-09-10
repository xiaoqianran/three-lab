precision highp float;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;

  float core = pow(1.0 - d * 2.0, 2.4);
  float halo = pow(1.0 - d, 3.0) * 0.3;
  float energy = core + halo;

  gl_FragColor = vec4(vColor * energy, energy * vAlpha);
}
