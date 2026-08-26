// WebGL 可用性 / 低端机 / 减弱动效 检测（development.md §6.2/§6.3 降级路线）。
// 调用方（页面）据返回值决定渲染完整 3D 场景还是静态降级版。

import { useState } from 'react';

export type WebGLCapability = 'full' | 'software' | 'none';

export interface CapabilityInfo {
  /** full = 可用且非软件渲染；software = 软渲染（低端/虚拟机，建议降级）；none = 不可用 */
  webgl: WebGLCapability;
  /** prefers-reduced-motion */
  reducedMotion: boolean;
  /** 低端机启发式：核心数少 + 内存小 */
  lowEnd: boolean;
}

/** 尝试创建 WebGL 上下文并探测渲染器，创建失败/软渲染返回降级档位。 */
export function detectWebGLCapability(): WebGLCapability {
  if (typeof document === 'undefined') return 'none';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'none';

    let software = false;
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
        : '';
      software = /swiftshader|software|llvmpipe|basic render/i.test(renderer);
    } catch {
      // 拿不到渲染器信息时按可用处理
    }
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // 忽略
    }
    return software ? 'software' : 'full';
  } catch {
    return 'none';
  }
}

export function detectCapabilities(): CapabilityInfo {
  let reducedMotion = false;
  let lowEnd = false;
  if (typeof window !== 'undefined') {
    reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const cores = navigator.hardwareConcurrency ?? 8;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
    lowEnd = cores <= 4 && mem <= 4;
  }
  return { webgl: detectWebGLCapability(), reducedMotion, lowEnd };
}

let cached: CapabilityInfo | null = null;

/** 进程内缓存一次（能力在运行期不变），测试环境（无 window）返回 'none'。 */
export function getCapabilities(): CapabilityInfo {
  if (!cached) cached = detectCapabilities();
  return cached;
}

/** React 侧取能力快照。 */
export function useCapabilities(): CapabilityInfo {
  const [caps] = useState<CapabilityInfo>(getCapabilities);
  return caps;
}
