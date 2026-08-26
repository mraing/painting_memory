// 数据逃生口 —— development.md §3.2「全部导出」：zip = 原图 + 立绘图层 + 日记 JSON。
// 用 jszip 实现；设置页入口。目录结构：
//   manifest.json           导出清单（时间/计数/说明）
//   book/<pageId>/page.json 书页元数据（月份/时间/立绘配置/日记/解读）
//   book/<pageId>/layers/*  立绘图层（foreground/background/base）
//   drafts/<draftId>/photo.*  待处理草稿原图
//   drafts/<draftId>/draft.json + layers/*
//   conversations.json      引导对话记录
//   profile.json            画像档案（§8.2）

import JSZip from 'jszip';
import { db, type BookPage, type Draft } from '../../db/db';

/** 按 Blob MIME 推断扩展名（未知 → bin） */
export function extOf(blob: Blob): string {
  const t = blob.type;
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  return 'bin';
}

/**
 * Blob → ArrayBuffer 再入 zip：jszip 的 Blob 读写依赖浏览器 FileReader，
 * 统一转 ArrayBuffer 保证浏览器/Node 双环境可用（导出是一次性动作，拷贝代价可接受）。
 */
async function blobToBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export interface ExportManifest {
  app: string;
  exportedAt: string;
  counts: { pages: number; drafts: number; conversations: number };
  note: string;
}

async function writeLayers(
  dir: JSZip,
  layers: Draft['layers'] | BookPage['layers'],
): Promise<void> {
  if (!layers) return;
  const folder = dir.folder('layers');
  if (!folder) return;
  if (layers.foreground)
    folder.file(`foreground.${extOf(layers.foreground)}`, await blobToBuffer(layers.foreground));
  if (layers.background)
    folder.file(`background.${extOf(layers.background)}`, await blobToBuffer(layers.background));
  if (layers.base) folder.file(`base.${extOf(layers.base)}`, await blobToBuffer(layers.base));
}

/** 收集全部本地数据 → zip Blob（纯函数，可在 Worker/Node 测试环境运行） */
export async function exportAllAsZip(): Promise<Blob> {
  const zip = new JSZip();

  const pages = await db.pages.orderBy('createdAt').toArray();
  const drafts = await db.drafts.orderBy('capturedAt').toArray();
  const conversations = await db.conversations.toArray();
  const profile = await db.profile.toArray();

  // —— 书页：元数据 JSON + 立绘图层 Blob ——
  const book = zip.folder('book');
  for (const p of pages) {
    const dir = book?.folder(p.id);
    dir?.file(
      'page.json',
      JSON.stringify(
        {
          id: p.id,
          month: p.month,
          createdAt: new Date(p.createdAt).toISOString(),
          config: p.config ?? {},
          diary: p.diary,
          interpretation: p.interpretation ?? null,
        },
        null,
        2,
      ),
    );
    await writeLayers(dir!, p.layers);
  }

  // —— 草稿：原图（照片仅在本地，导出即备份）+ 阶段/解读 ——
  const draftsFolder = zip.folder('drafts');
  for (const d of drafts) {
    const dir = draftsFolder?.folder(d.id);
    dir?.file(`photo.${extOf(d.photoBlob)}`, await blobToBuffer(d.photoBlob));
    dir?.file(
      'draft.json',
      JSON.stringify(
        {
          id: d.id,
          stage: d.stage,
          capturedAt: new Date(d.capturedAt).toISOString(),
          interpretation: d.interpretation ?? null,
          diaryText: d.diaryText ?? null,
          cutoutConfig: d.cutoutConfig ?? null,
        },
        null,
        2,
      ),
    );
    await writeLayers(dir!, d.layers);
  }

  // —— 对话 / 画像 ——
  zip.file(
    'conversations.json',
    JSON.stringify(
      conversations.map((c) => ({
        id: c.id,
        draftId: c.draftId,
        status: c.status,
        updatedAt: new Date(c.updatedAt).toISOString(),
        messages: c.messages.map((m) => ({ ...m, at: new Date(m.at).toISOString() })),
      })),
      null,
      2,
    ),
  );
  zip.file('profile.json', JSON.stringify(profile, null, 2));

  // —— 导出清单 ——
  const manifest: ExportManifest = {
    app: '绘忆',
    exportedAt: new Date().toISOString(),
    counts: {
      pages: pages.length,
      drafts: drafts.length,
      conversations: conversations.length,
    },
    note: '由绘忆「全部导出」生成：原图 + 立绘图层 + 日记 JSON。照片仅存在于本机；云端仅存立绘产物、解读日志与画像档案。',
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  return zip.generateAsync({ type: 'blob' });
}

/** 导出文件名：绘忆时光绘本-YYYY-MM-DD.zip */
export function exportZipFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `绘忆时光绘本-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

/** 生成并触发浏览器下载 */
export async function downloadExportZip(): Promise<void> {
  const blob = await exportAllAsZip();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportZipFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
