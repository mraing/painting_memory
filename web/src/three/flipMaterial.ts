// 翻页材质：页绕书脊刚性旋转（α = progress·π，上翻过顶）+ 静态纸卷曲（curl），
// 双面渲染，背面自动镜像 UV（透纸观感/背页文字不反）。选型理由见 docs/book-3d.md。

import * as THREE from 'three';

export const FLIP_VERTEX_SHADER = /* glsl */ `
uniform float uProgress; // 0..1，0 = 平放，1 = 翻完（落到另一侧）
uniform float uPageW;    // 单页宽（世界单位）
uniform float uCurl;     // 纸卷曲强度（相对页宽比例，翻完时渐隐为 0）
varying vec2 vUv;

void main() {
  vUv = uv;
  // 局部坐标：页宽沿 X，脊柱边在 x = -W/2；u ∈ [0, W] 从脊柱到页尖
  float u = position.x + uPageW * 0.5;
  float PI = 3.141592653589793;
  float alpha = uProgress * PI;             // 刚性旋转角（绕脊柱，上翻过顶）
  float curl = uCurl * (1.0 - smoothstep(0.7, 1.0, uProgress)); // 翻完摊平
  float lift = curl * u * (u / uPageW);     // 二次曲线：脊柱处 0，页尖最大

  // 绕脊柱（局部 Y 轴）旋转 + 沿局部 Z 的卷曲（经 mesh.rotation.x=-PI/2 映射为世界 Y 抬起）
  vec3 pos = vec3(
    u * cos(alpha) - uPageW * 0.5,
    position.y,
    u * sin(alpha) + lift
  );
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const FLIP_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform float uMirrorU; // 后翻（镜像网格）时恢复文字方向
varying vec2 vUv;

void main() {
  vec2 uv2 = vUv;
  if (uMirrorU > 0.5) uv2.x = 1.0 - uv2.x;
  if (!gl_FrontFacing) uv2.x = 1.0 - uv2.x; // 背面镜像 → 透纸读字不反
  gl_FragColor = texture2D(uMap, uv2);
}
`;

export interface FlipMaterialOptions {
  map: THREE.Texture | null;
  /** 默认卷曲强度（相对页宽比例，0.04 ≈ 页尖抬起 4% 页宽） */
  curl?: number;
  mirrorU?: boolean;
}

export function createFlipMaterial(opts: FlipMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FLIP_VERTEX_SHADER,
    fragmentShader: FLIP_FRAGMENT_SHADER,
    uniforms: {
      uProgress: { value: 0 },
      uPageW: { value: 2 },
      uCurl: { value: opts.curl ?? 0.04 },
      uMap: { value: opts.map },
      uMirrorU: { value: opts.mirrorU ? 1 : 0 },
    },
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}
