// /lab/3d 演示用 mock 数据：程序化 canvas 生成立绘图层与书页（不引入外部素材）。
// 立绘图层：纸页底 + 虚化背景 + 剪纸猫（alpha）+ 模糊投影；
// 书页：纸纹 + 照片块 + 日期/标题/日记文字 + 朱红小落款。

import type { IllustrationLayers } from '../IllustrationScene';
import type { BookPage3D } from '../BookViewer';

const PAPER = '#F4EFE6';
const INK = '#3A362F';
const INK_SOFT = '#857E70';
const VERMILION = '#B83A1E';

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

function toDataURL(c: HTMLCanvasElement): string {
  return c.toDataURL('image/png');
}

/** 等待字体就绪（canvas 文字用 Noto Serif SC），失败静默。 */
async function awaitFonts(): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    /* 忽略 */
  }
}

function drawPaperGrain(ctx: CanvasRenderingContext2D, w: number, h: number, seed = 1) {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 2600; i++) {
    const x = rand() * w;
    const y = rand() * h;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(90,75,55,0.05)';
    ctx.lineWidth = rand() < 0.3 ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y + (rand() - 0.5) * 3);
    ctx.stroke();
  }
}

/* ---------- 立绘图层 ---------- */

/** 剪纸猫剪影（坐姿侧影，贝塞尔拼成） */
function drawCatSilhouette(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  s: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  // 尾巴
  ctx.moveTo(52, 62);
  ctx.bezierCurveTo(88, 58, 104, 40, 100, 22);
  ctx.bezierCurveTo(98, 14, 88, 12, 84, 18);
  ctx.bezierCurveTo(78, 28, 66, 34, 50, 36);
  // 背
  ctx.bezierCurveTo(34, 28, 26, 16, 28, 4);
  ctx.bezierCurveTo(28, -4, 20, -12, 10, -18);
  // 右耳
  ctx.lineTo(16, -38);
  ctx.lineTo(30, -26);
  // 左耳
  ctx.lineTo(38, -38);
  ctx.lineTo(44, -22);
  // 脸
  ctx.bezierCurveTo(58, -18, 70, -8, 72, 2);
  ctx.bezierCurveTo(76, 12, 70, 26, 60, 36);
  // 胸
  ctx.bezierCurveTo(66, 44, 76, 52, 78, 62);
  ctx.bezierCurveTo(74, 78, 60, 84, 48, 82);
  ctx.bezierCurveTo(34, 86, 18, 84, 8, 78);
  ctx.bezierCurveTo(0, 74, 2, 66, 12, 64);
  ctx.bezierCurveTo(26, 60, 40, 60, 52, 62);
  ctx.closePath();
  ctx.fill();
  // 耳内
  ctx.fillStyle = 'rgba(244,239,230,0.55)';
  ctx.beginPath();
  ctx.moveTo(18, -34);
  ctx.lineTo(26, -24);
  ctx.lineTo(13, -22);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(40, -32);
  ctx.lineTo(42, -20);
  ctx.lineTo(33, -23);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 立绘三层 + 投影（dataURL）。variant 影响背景色板与颗粒种子（mock 多页区分用）。 */
export async function makeMockLayers(variant = 0): Promise<IllustrationLayers> {
  await awaitFonts();
  const W = 480;
  const H = 640;
  const [sky0, sky1, sky2] = (
    [
      ['#E8E0CE', '#D8C9AE', '#B7A488'], // 暮色
      ['#DDE3D4', '#C9D2BC', '#A3AE93'], // 苔绿
      ['#E6DDD6', '#D4C2B4', '#B0907C'], // 陶土
      ['#DCE4E6', '#C4D2D4', '#93A6AA'], // 水蓝
    ] as const
  )[variant % 4];

  // 纸页底
  const [baseC, baseCtx] = canvasOf(W, H);
  baseCtx.fillStyle = PAPER;
  baseCtx.fillRect(0, 0, W, H);
  drawPaperGrain(baseCtx, W, H, 11 + variant * 7);
  const vig = baseCtx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 340);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(90,75,55,0.10)');
  baseCtx.fillStyle = vig;
  baseCtx.fillRect(0, 0, W, H);

  // 背景虚化层：暮色天空 + 山丘（预虚化，WebGL 侧不做后处理）
  const [bgC, bgCtx] = canvasOf(W, H);
  const sky = bgCtx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, sky0);
  sky.addColorStop(0.55, sky1);
  sky.addColorStop(1, sky2);
  bgCtx.fillStyle = sky;
  bgCtx.fillRect(0, 0, W, H);
  try {
    bgCtx.filter = 'blur(14px)';
  } catch {
    /* 老浏览器无 canvas filter，直线退化 */
  }
  bgCtx.fillStyle = 'rgba(184,58,30,0.55)';
  bgCtx.beginPath();
  bgCtx.arc(W * (0.62 + 0.04 * variant), H * 0.28, 46, 0, Math.PI * 2);
  bgCtx.fill(); // 朱红落日
  bgCtx.fillStyle = 'rgba(58,54,48,0.20)';
  bgCtx.beginPath();
  bgCtx.ellipse(W * 0.3, H * 0.68, 180, 46, -0.08, 0, Math.PI * 2);
  bgCtx.fill();
  bgCtx.beginPath();
  bgCtx.ellipse(W * 0.82, H * 0.74, 220, 60, 0.1, 0, Math.PI * 2);
  bgCtx.fill();
  try {
    bgCtx.filter = 'none';
  } catch {
    /* 忽略 */
  }

  // 前景剪纸（alpha 纹理）
  const [fgC, fgCtx] = canvasOf(W, H);
  drawCatSilhouette(fgCtx, W * 0.46, H * 0.62, 1.9, INK);

  // 剪纸投影（模糊剪影）
  const [shC, shCtx] = canvasOf(W, H);
  drawCatSilhouette(shCtx, W * 0.47, H * 0.635, 1.9, 'rgba(40,30,20,1)');
  try {
    shCtx.filter = 'blur(9px)';
  } catch {
    /* 忽略 */
  }
  const [sh2C, sh2Ctx] = canvasOf(W, H);
  sh2Ctx.drawImage(shC, 0, 0);
  sh2Ctx.globalAlpha = 0.4;
  sh2Ctx.filter = 'blur(9px)';
  sh2Ctx.drawImage(shC, 0, 0);
  try {
    sh2Ctx.filter = 'none';
  } catch {
    /* 忽略 */
  }

  return {
    base: toDataURL(baseC),
    background: toDataURL(bgC),
    foreground: toDataURL(fgC),
    shadow: toDataURL(sh2C),
  };
}

/* ---------- 书页 ---------- */

const PHOTO_SCENES: Array<{ hue: string; note: string; seed: number }> = [
  { hue: '#C9A17E', note: '午后的光', seed: 21 },
  { hue: '#9BA88C', note: '雨后的绿', seed: 22 },
  { hue: '#A88B9A', note: '傍晚的风', seed: 23 },
  { hue: '#8CA3A8', note: '海边的蓝', seed: 24 },
  { hue: '#C4A66B', note: '秋天的暖', seed: 25 },
  { hue: '#9C8FB0', note: '夜里的灯', seed: 26 },
];

const DIARIES = [
  '那天你站在窗边看了很久，猫在你脚边打盹。你忽然觉得，这样的下午再多几个也不嫌多。',
  '你记得雨停后空气里的味道。路边的叶子亮得不像话，你拍了又拍，最后还是选了这张。',
  '傍晚的风把云吹成薄薄一片。你说，日子好像也没那么赶，慢慢走，也能到。',
  '海浪一层一层地来，你蹲在沙滩上等它。等来的不是贝壳，是一整个下午的安静。',
  '你把银杏叶夹进书里，说等它干了，就是秋天寄来的信。',
  '那盏灯亮到很晚。你写了几个字又删掉，最后只留下一句：今天很好，明天也试试。',
];

/** 书页：纸纹 + 照片块 + 日期/标题/日记 + 页码 + 朱红落款 */
async function makePageCanvas(
  month: string,
  day: number,
  sceneIdx: number,
  index: number,
  total: number,
): Promise<HTMLCanvasElement> {
  await awaitFonts();
  const W = 540;
  const H = 720;
  const [c, ctx] = canvasOf(W, H);

  // 纸底
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  drawPaperGrain(ctx, W, H, 30 + sceneIdx);

  const scene = PHOTO_SCENES[sceneIdx % PHOTO_SCENES.length];
  const photoX = 44;
  const photoY = 88;
  const photoW = W - 88;
  const photoH = 400;

  // 照片块
  ctx.save();
  ctx.shadowColor = 'rgba(58,54,48,0.25)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = scene.hue;
  ctx.fillRect(photoX, photoY, photoW, photoH);
  ctx.restore();
  // 照片里的内容：渐变 + 剪影 + 颗粒
  const grad = ctx.createLinearGradient(photoX, photoY, photoX + photoW, photoY + photoH);
  grad.addColorStop(0, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(30,25,20,0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(photoX, photoY, photoW, photoH);
  ctx.fillStyle = 'rgba(58,54,48,0.85)';
  ctx.beginPath();
  ctx.ellipse(
    photoX + photoW * 0.52,
    photoY + photoH * 0.6,
    photoW * 0.20,
    photoH * 0.26,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = 'rgba(244,239,230,0.75)';
  ctx.beginPath();
  ctx.arc(photoX + photoW * 0.24, photoY + photoH * 0.26, 16, 0, Math.PI * 2);
  ctx.fill();
  drawPaperGrain(ctx, photoW, photoH, 100 + sceneIdx);
  // 相纸白边
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(photoX + 8, photoY + 8, photoW - 16, photoH - 16);

  // 日期
  ctx.fillStyle = INK_SOFT;
  ctx.font = '26px "Noto Serif SC", "Songti SC", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const [yy, mm] = month.split('-');
  ctx.fillText(`${yy} 年 ${mm} 月 ${String(day).padStart(2, '0')} 日`, 44, 62);

  // 标题
  ctx.fillStyle = INK;
  ctx.font = '600 34px "Noto Serif SC", "Songti SC", serif';
  ctx.fillText(scene.note, 44, 540);

  // 日记（第三行省略号收束）
  ctx.font = '26px "Noto Serif SC", "Songti SC", serif';
  ctx.fillStyle = INK_SOFT;
  const lineH = 44;
  const diary = DIARIES[sceneIdx % DIARIES.length];
  let y = 596;
  for (const line of [diary.slice(0, 13), diary.slice(13, 26), diary.slice(26, 38)]) {
    if (!line) break;
    ctx.fillText(line, 44, y);
    y += lineH;
  }

  // 页码 + 朱红小落款
  ctx.fillStyle = INK_SOFT;
  ctx.font = '22px serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${index + 1}`, W - 44, H - 40);
  ctx.save();
  ctx.translate(56, H - 46);
  ctx.rotate(-0.06);
  ctx.strokeStyle = VERMILION;
  ctx.lineWidth = 2;
  ctx.strokeRect(-14, -14, 28, 28);
  ctx.fillStyle = VERMILION;
  ctx.font = '22px "Noto Serif SC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('忆', 0, 3);
  ctx.restore();

  void total;
  return c;
}

/** 6 页 / 3 个月（2026-04 ~ 2026-06），返回 dataURL 页图。 */
export async function makeMockPages(count = 6): Promise<BookPage3D[]> {
  const months = ['2026-04', '2026-05', '2026-06'];
  const days = [18, 26, 12];
  const out: BookPage3D[] = [];
  for (let i = 0; i < count; i++) {
    const month = months[Math.floor((i / 2) % months.length)];
    const day = days[Math.floor((i / 2) % months.length)] + (i % 2);
    out.push({
      id: `mock-${i}`,
      month,
      image: toDataURL(await makePageCanvas(month, day, i, i, count)),
    });
  }
  return out;
}
