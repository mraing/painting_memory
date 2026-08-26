// 纸颗粒纹理 —— development.md §4.2/§4.3「纸感底色 Paper Base」。
// canvas 程序化生成极低对比噪点 + 少量纵向纤维，输出数据 URL 供 CSS 平铺。
// 设计原则：纹理只作辅助，绝不得干扰正文（alpha 极低、无低频结构）。
// 噪声按像素逐点随机 → 平铺时无可见接缝；纤维采用环绕绘制保证 tile 无缝。

import { tokens } from './tokens';

const SIZE = tokens.paperGrainSize;
let cached: string | null = null;

/** 生成（并缓存）纸颗粒纹理的数据 URL */
export function getPaperTexture(): string {
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // 极端环境下拿不到 2d context：返回空，样式层自动退化为纯色纸底
    cached = '';
    return cached;
  }

  // 1) 逐像素颗粒噪点：墨色偏置 ±5，alpha 6~14（约 2.4%~5.5% 黑度，极轻）
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    d[i] = 90 + n; // R
    d[i + 1] = 86 + n * 0.9; // G
    d[i + 2] = 79 + n * 0.7; // B
    d[i + 3] = 6 + Math.random() * 8; // A
  }
  ctx.putImageData(img, 0, 0);

  // 2) 少量纵向纸纤维：环绕 tile 边界绘制，保证无缝平铺
  ctx.lineCap = 'round';
  for (let i = 0; i < 36; i++) {
    const x = Math.random() * SIZE;
    const y = Math.random() * SIZE;
    const len = 12 + Math.random() * 34;
    const alpha = 0.015 + Math.random() * 0.025;
    ctx.strokeStyle = `rgba(58, 54, 47, ${alpha})`;
    ctx.lineWidth = 0.5 + Math.random() * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + len);
    ctx.stroke();
    // 跨越底边时，在顶部补画同一段 → 上下平铺无缝
    if (y + len > SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, y - SIZE);
      ctx.lineTo(x, y + len - SIZE);
      ctx.stroke();
    }
  }

  cached = canvas.toDataURL('image/png');
  return cached;
}

/**
 * 把纹理注入 CSS 变量 --paper-texture（供 body 平铺）。
 * 建议在应用启动时调用一次（main.tsx）。
 */
export function applyPaperTexture(root: HTMLElement = document.documentElement): void {
  const url = getPaperTexture();
  root.style.setProperty('--paper-texture', url ? `url("${url}")` : 'none');
}
