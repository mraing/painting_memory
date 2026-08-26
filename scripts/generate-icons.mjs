// 生成 PWA 纸感图标（零依赖：内建 zlib + 自写 PNG 编码器 + 4x 超采样抗锯齿）。
// 设计：纸色底 + 颗粒噪点 + 剪纸分层山影（ink-soft/earth/moss）+ 朱红圆日（落款级小点缀），
// 呼应产品「剪纸立体绘本」。确定性种子，可复现。
// 用法: node scripts/generate-icons.mjs   （输出 web/public/icons/ 三个 PNG）
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'web', 'public', 'icons');

// —— 工具：PNG 编码（RGBA, 8bit, 无滤波）——
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(img) {
  const { w, h, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = data[y * w * 4 + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// —— 工具：软件光栅 ——
function createCanvas(w, h) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}
function blend(dst, i, [r, g, b, a]) {
  const da = dst[i + 3];
  const outA = a + da * (1 - a / 255);
  if (outA <= 0) return;
  dst[i] = Math.round((r * a + dst[i] * da * (1 - a / 255)) / outA);
  dst[i + 1] = Math.round((g * a + dst[i + 1] * da * (1 - a / 255)) / outA);
  dst[i + 2] = Math.round((b * a + dst[i + 2] * da * (1 - a / 255)) / outA);
  dst[i + 3] = Math.round(outA);
}
function fillRect(img, x0, y0, x1, y1, rgba) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.h, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.w, Math.ceil(x1)); x++)
      blend(img.data, (y * img.w + x) * 4, rgba);
}
function fillCircle(img, cx, cy, r, rgba) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) blend(img.data, (y * img.w + x) * 4, rgba);
    }
}
/** 抛物线山形：底边 baseY，峰高 peakH，峰心 peakX，宽 halfW */
function fillHill(img, baseY, peakX, halfW, peakH, rgba) {
  for (let x = Math.floor(peakX - halfW); x <= Math.ceil(peakX + halfW); x++) {
    const t = (x + 0.5 - peakX) / halfW; // -1..1
    if (t < -1 || t > 1) continue;
    const yTop = baseY - peakH * (1 - t * t);
    for (let y = Math.floor(yTop); y < baseY; y++) blend(img.data, (y * img.w + x) * 4, rgba);
  }
}
/** 4x 超采样后盒式降采样 */
function downsample(src, scale) {
  const w = Math.round(src.w / scale);
  const h = Math.round(src.h / scale);
  const out = createCanvas(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * src.w + (x * scale + dx)) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3];
        }
      const n = scale * scale;
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = a / n;
    }
  return out;
}

// —— 确定性随机 ——
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// —— 绘制（S 为渲染边长；contentScale 用于 maskable 安全区）——
function drawArt(S, contentScale, seed) {
  const rnd = mulberry32(seed);
  const img = createCanvas(S, S);
  const paper = [244, 239, 230, 255];
  fillRect(img, 0, 0, S, S, paper);

  // 内容坐标系：缩放到安全区
  const cs = contentScale;
  const off = (S * (1 - cs)) / 2;
  const X = (v) => off + v * cs;
  const Y = (v) => off + v * cs;
  const R = (v) => v * cs;

  // 颗粒噪点（极轻）
  for (let i = 0; i < img.data.length; i += 4) {
    if (rnd() < 0.55) {
      const n = 4 + rnd() * 8;
      img.data[i] = Math.max(0, img.data[i] - n);
      img.data[i + 1] = Math.max(0, img.data[i + 1] - n * 0.9);
      img.data[i + 2] = Math.max(0, img.data[i + 2] - n * 0.7);
      img.data[i + 3] = Math.min(255, img.data[i + 3] + 3);
    }
  }

  // 剪纸分层：远山 ink-soft → 中景 earth → 近景 moss（山脚压到画布底外，防漏白）
  const w = S;
  fillHill(img, Y(w + 20), X(w * 0.5), R(w * 0.62), R(w * 0.26), [133, 126, 112, 110]);
  fillHill(img, Y(w + 20), X(w * 0.32), R(w * 0.58), R(w * 0.34), [180, 154, 124, 150]);
  fillHill(img, Y(w + 20), X(w * 0.68), R(w * 0.66), R(w * 0.3), [119, 128, 107, 165]);

  // 朱红圆日（落款级小点缀，偏右上）
  fillCircle(img, X(w * 0.78), Y(w * 0.26), R(w * 0.052), [184, 58, 30, 235]);

  // 纸页折角：右下角一条浅 ink 细边（立体绘本的「纸」暗示）
  const fold = R(w * 0.14);
  fillRect(img, X(w - 0.03 * w) - 2, Y(w - fold), X(w - 0.03 * w) + 2, Y(w + 20), [58, 54, 47, 26]);
  fillRect(img, X(w - fold), Y(w - 0.03 * w) - 2, X(w + 20), Y(w - 0.03 * w) + 2, [58, 54, 47, 26]);

  return img;
}

const SS = 4; // 4x 超采样
function render(size, contentScale, seed) {
  const big = drawArt(size * SS, contentScale, seed);
  return downsample(big, SS);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon-192.png'), encodePng(render(192, 1, 19260817)));
writeFileSync(join(OUT_DIR, 'icon-512.png'), encodePng(render(512, 1, 19260817)));
writeFileSync(join(OUT_DIR, 'icon-512-maskable.png'), encodePng(render(512, 0.8, 19260817)));
console.log('icons written to', OUT_DIR, '(192 / 512 / 512-maskable)');
