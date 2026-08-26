// 书页数据访问（features/book）—— pages 表 → 浏览/单页数据。
// t6 主流程未完成时 pages 表为空 → mock 兜底（BOOK_MOCK_FALLBACK，联调/验收可见）。

import { db, type BookPage } from '../../db/db';
import type { BookPageItem } from './types';
import { makeMockItems } from './mockData';

/** pages 表为空时是否回退 mock 数据（t6 完成前开发兜底；验收后置 false 即可） */
export const BOOK_MOCK_FALLBACK = true;

export interface LoadResult {
  items: BookPageItem[];
  /** 数据是否来自 mock（t6 未完成时的开发兜底） */
  isMock: boolean;
}

/** 加载书页：真实数据优先（按 createdAt 升序，最新页在末位）；空表走 mock 兜底 */
export async function loadBookPages(
  opts?: { mockFactory?: () => Promise<BookPageItem[]> },
): Promise<LoadResult> {
  const real = await db.pages.orderBy('createdAt').toArray();
  if (real.length > 0) {
    const items = await Promise.all(real.map(pageToItem));
    return { items, isMock: false };
  }
  if (BOOK_MOCK_FALLBACK) {
    const factory = opts?.mockFactory ?? makeMockItems;
    return { items: await factory(), isMock: true };
  }
  return { items: [], isMock: false };
}

/** 删除一页（§9：仅保留删除；长按书页 → 确认 → 调用） */
export async function deleteBookPage(id: string): Promise<void> {
  await db.pages.delete(id);
}

/** 真实书页 → 浏览/单页条目：页图由图层 canvas 合成（失败降级空白纸） */
async function pageToItem(page: BookPage): Promise<BookPageItem> {
  return {
    id: page.id,
    month: page.month,
    image: await composePageImage(page),
    diary: page.diary ?? '',
    layers: {
      base: page.layers.base,
      background: page.layers.background,
      foreground: page.layers.foreground,
    },
  };
}

/**
 * 图层 → 预渲染页图（§6.2 浏览层页图）：canvas 合成 纸底 → 背景虚化层 → 前景剪纸，
 * 输出 3:4 PNG Blob；无图层/环境无 canvas/失败 → null（浏览层显示空白纸）。
 * t6 收书时也可复用此函数生成浏览层页图。
 */
export async function composePageImage(page: BookPage): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const { base, background, foreground } = page.layers;
  if (!base && !background && !foreground) return null;
  try {
    const W = 540;
    const H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // 纸底
    ctx.fillStyle = '#F4EFE6';
    ctx.fillRect(0, 0, W, H);
    await drawLayer(ctx, base, W, H);
    await drawLayer(ctx, background, W, H);
    await drawLayer(ctx, foreground, W, H);
    return await canvasToBlob(canvas);
  } catch {
    return null;
  }
}

/** 把 Blob 图层铺到画布（拉伸铺满；单层失败不影响整体） */
async function drawLayer(
  ctx: CanvasRenderingContext2D,
  blob: Blob | undefined,
  w: number,
  h: number,
): Promise<void> {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadBlobImage(url);
    ctx.drawImage(img, 0, 0, w, h);
  } catch {
    /* 单层失败忽略 */
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadBlobImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图层加载失败'));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
