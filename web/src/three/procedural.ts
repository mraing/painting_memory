// 程序化 canvas 纹理生成（development.md §4.4：亚麻布纹封面 / 纸纹，不引入外部素材）。
// 所有生成函数均为纯 canvas 操作，可在任意环境（浏览器/离线）运行。

import * as THREE from 'three';

/** 简单可复现随机数（避免每次生成不同纹理） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 画细颗粒噪点（纸感），stride 越小颗粒越密 */
function drawGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rand: () => number,
  count: number,
  colors: string[],
  maxLen = 3,
) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    ctx.strokeStyle = colors[Math.floor(rand() * colors.length)];
    ctx.lineWidth = rand() < 0.3 ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * maxLen, y + (rand() - 0.5) * maxLen);
    ctx.stroke();
  }
}

/** 朱红落款小方印（侘寂点睛，development.md §4.3 --vermilion） */
function drawSeal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  char: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.06);
  ctx.strokeStyle = '#B83A1E';
  ctx.lineWidth = Math.max(2, size * 0.06);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.fillStyle = 'rgba(184, 58, 30, 0.10)';
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.fillStyle = '#B83A1E';
  ctx.font = `${size * 0.58}px "Noto Serif SC", "Songti SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, 0, size * 0.06);
  ctx.restore();
}

export interface LinenOptions {
  /** 布面主色（亚麻原色） */
  base?: string;
  /** 深色变体（书底托板用） */
  dark?: boolean;
  width?: number;
  height?: number;
  /** 书名字体位（《时光绘本》），空字符串则不画 */
  title?: string;
  subtitle?: string;
}

/**
 * 亚麻布纹封面纹理：布纹纤维 + 轻微暗角 + 书名字体压印（emboss）+ 朱红落款。
 */
export function makeLinenCanvas(opts: LinenOptions = {}): HTMLCanvasElement {
  const {
    base = '#C6B49B',
    dark = false,
    width = 512,
    height = 682,
    title = '时光绘本',
    subtitle = '岁月 · 光影 · 你',
  } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(dark ? 20260827 : 20260826);

  // 布面底色
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // 亚麻纤维：交错短线的经纬感
  ctx.globalAlpha = 0.5;
  const fibers = dark
    ? ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.10)']
    : ['rgba(255,250,240,0.10)', 'rgba(80,60,35,0.08)'];
  for (let i = 0; i < (dark ? 3200 : 2600); i++) {
    const x = rand() * width;
    const y = rand() * height;
    const vertical = rand() < 0.45;
    ctx.strokeStyle = fibers[Math.floor(rand() * fibers.length)];
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 2, y + 3 + rand() * 10);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + 3 + rand() * 10, y + (rand() - 0.5) * 2);
    }
    ctx.stroke();
  }
  // 细颗粒
  drawGrain(
    ctx,
    width,
    height,
    rand,
    dark ? 4000 : 3000,
    dark ? ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.06)'] : ['rgba(255,255,255,0.05)', 'rgba(70,55,35,0.05)'],
    2,
  );
  ctx.globalAlpha = 1;

  // 轻微暗角
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(40,28,12,0.18)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  if (title) {
    // 书名竖排压印（emboss：暗色上移 + 亮色下移 + 主色）
    const fontSize = Math.round(width * 0.115);
    ctx.save();
    ctx.translate(width * 0.5, height * 0.42);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `${fontSize}px "Noto Serif SC", "Songti SC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const passes: Array<[string, number, number]> = [
      ['rgba(52,38,20,0.55)', -2, -2],
      ['rgba(255,248,235,0.65)', 2, 2],
      [dark ? '#EFE6D6' : '#4A3B28', 0, 0],
    ];
    for (const [color, dx, dy] of passes) {
      ctx.fillStyle = color;
      ctx.fillText(title, dx, dy);
    }
    ctx.restore();

    if (subtitle) {
      ctx.save();
      ctx.translate(width * 0.5, height * 0.585);
      ctx.rotate(-Math.PI / 2);
      ctx.font = `${Math.round(width * 0.042)}px "Noto Serif SC", "Songti SC", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(74,59,40,0.78)';
      ctx.fillText(subtitle, 0, 0);
      ctx.restore();
    }

    drawSeal(ctx, width * 0.5, height * 0.68, Math.round(width * 0.11), '忆');
  }

  return canvas;
}

export function makeLinenTexture(opts: LinenOptions = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(makeLinenCanvas(opts));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** 纸纹（--paper 米白 + 细颗粒），书底托板/静态页衬底用。 */
export function makePaperCanvas(base = '#F4EFE6', width = 256, height = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(20260825);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  drawGrain(
    ctx,
    width,
    height,
    rand,
    2200,
    ['rgba(255,255,255,0.06)', 'rgba(90,75,55,0.05)', 'rgba(120,100,70,0.03)'],
    2,
  );
  return canvas;
}

export function makePaperTexture(base = '#F4EFE6', width = 256, height = 256): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(makePaperCanvas(base, width, height));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** 把一张图片转为带颜色的矩形画布（颜色工具，供 mock 用） */
export function tintCanvas(
  base: string,
  width: number,
  height: number,
  seed = 1,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  drawGrain(
    ctx,
    width,
    height,
    rand,
    1500,
    ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.04)'],
    2,
  );
  return canvas;
}
