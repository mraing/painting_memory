// 导出逃生口与云端档案清除测试（§3.2 / §7）
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { db } from '../../db/db';
import { exportAllAsZip, exportZipFileName, extOf } from './index';
import { deleteCloudArchive } from '../archive';
import { createEmptyProfile } from '../memory/types';

const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
const jpg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

beforeEach(async () => {
  await Promise.all([
    db.pages.clear(),
    db.drafts.clear(),
    db.conversations.clear(),
    db.profile.clear(),
    db.settings.clear(),
  ]);
});

describe('导出 zip', () => {
  it('内容完整：书页图层/日记、草稿原图、对话、画像、清单', async () => {
    await db.pages.put({
      id: 'p1',
      month: '2026-08',
      createdAt: 1000,
      config: { depth: 0.4 },
      layers: { foreground: png, background: jpg, base: png },
      diary: '那天阳光很好，你说要记住这一刻。',
      interpretation: { subject: '一只猫' },
    });
    await db.drafts.put({
      id: 'd1',
      photoBlob: jpg,
      capturedAt: 2000,
      stage: 'converted',
      layers: { foreground: png },
      interpretation: { subject: '一只猫' },
      diaryText: '草稿日记',
    });
    await db.conversations.put({
      id: 'c1',
      draftId: 'd1',
      status: 'finished',
      updatedAt: 3000,
      messages: [
        { role: 'ai', text: '画面里的小家伙是你养的吧？', at: 3001 },
        { role: 'user', text: '对，它叫团子', at: 3002 },
      ],
    });
    await db.profile.put({
      id: 'me',
      data: createEmptyProfile(),
      updatedAt: '2026-08-26T00:00:00.000Z',
    });

    const blob = await exportAllAsZip();
    expect(blob.type).toBe('application/zip');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();

    expect(names).toContain('book/p1/page.json');
    expect(names).toContain('book/p1/layers/foreground.png');
    expect(names).toContain('book/p1/layers/background.jpg');
    expect(names).toContain('book/p1/layers/base.png');
    expect(names).toContain('drafts/d1/photo.jpg');
    expect(names).toContain('drafts/d1/draft.json');
    expect(names).toContain('drafts/d1/layers/foreground.png');
    expect(names).toContain('conversations.json');
    expect(names).toContain('profile.json');
    expect(names).toContain('manifest.json');

    const page = JSON.parse(await zip.file('book/p1/page.json')!.async('string'));
    expect(page.diary).toContain('那天阳光很好');
    expect(page.interpretation.subject).toBe('一只猫');
    expect(page.config.depth).toBe(0.4);

    const draft = JSON.parse(await zip.file('drafts/d1/draft.json')!.async('string'));
    expect(draft.stage).toBe('converted');
    expect(draft.diaryText).toBe('草稿日记');

    const conv = JSON.parse(await zip.file('conversations.json')!.async('string'));
    expect(conv).toHaveLength(1);
    expect(conv[0].messages[1].text).toBe('对，它叫团子');

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.app).toBe('绘忆');
    expect(manifest.counts).toEqual({ pages: 1, drafts: 1, conversations: 1 });

    // 图层 Blob 字节原样保留
    const fg = await zip.file('book/p1/layers/foreground.png')!.async('uint8array');
    expect(Array.from(fg)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const bg = await zip.file('book/p1/layers/background.jpg')!.async('uint8array');
    expect(Array.from(bg)).toEqual([0xff, 0xd8, 0xff]);
  });

  it('空库导出：只含清单与空集合，不报错', async () => {
    const blob = await exportAllAsZip();
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.counts).toEqual({ pages: 0, drafts: 0, conversations: 0 });
    expect(zip.files['book/']).toBeTruthy();
  });

  it('extOf 按 MIME 推断扩展名，未知类型兜底 bin', () => {
    expect(extOf(new Blob([], { type: 'image/png' }))).toBe('png');
    expect(extOf(new Blob([], { type: 'image/jpeg' }))).toBe('jpg');
    expect(extOf(new Blob([], { type: 'application/octet-stream' }))).toBe('bin');
  });

  it('导出文件名带日期', () => {
    expect(exportZipFileName(new Date(2026, 7, 26))).toBe('绘忆时光绘本-2026-08-26.zip');
  });
});

describe('删除云端档案（本地副本）', () => {
  it('清除画像与解读冗余，保留书页日记与草稿照片', async () => {
    await db.pages.put({
      id: 'p1',
      month: '2026-08',
      createdAt: 1000,
      config: {},
      layers: { foreground: png },
      diary: '这一页的日记要保留',
      interpretation: { subject: '猫' },
    });
    await db.pages.put({
      id: 'p2',
      month: '2026-08',
      createdAt: 2000,
      config: {},
      layers: {},
      diary: '没有解读的一页',
    });
    await db.drafts.put({
      id: 'd1',
      photoBlob: jpg,
      capturedAt: 3000,
      stage: 'captured',
      interpretation: { subject: '狗' },
    });
    await db.profile.put({
      id: 'me',
      data: { ...createEmptyProfile(), people: [{ name: '妈妈', traits: [], count: 3 }] },
      updatedAt: '2026-08-26T00:00:00.000Z',
    });

    const result = await deleteCloudArchive();
    expect(result.cleared).toEqual({ profile: true, interpretations: 2 });

    const p1 = await db.pages.get('p1');
    expect(p1!.diary).toBe('这一页的日记要保留');
    expect(p1!.interpretation).toBeUndefined();
    // fake-indexeddb 结构化克隆 Blob，引用不同 → 比字节
    const kept = new Uint8Array(await p1!.layers.foreground!.arrayBuffer());
    expect(Array.from(kept)).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const d1 = await db.drafts.get('d1');
    // fake-indexeddb 结构化克隆 Blob，引用不同 → 比字节
    const keptPhoto = new Uint8Array(await d1!.photoBlob.arrayBuffer());
    expect(Array.from(keptPhoto)).toEqual([0xff, 0xd8, 0xff]);
    expect(d1!.interpretation).toBeUndefined();

    const profile = await db.profile.get('me');
    const data = profile!.data as ReturnType<typeof createEmptyProfile>;
    // updatedAt 是毫秒级时间戳，逐字段比较其余部分
    expect(data.user).toEqual(createEmptyProfile().user);
    expect(data.people).toEqual([]);
    expect(data.places).toEqual([]);
    expect(data.preferences).toEqual([]);
    expect(data.importantDates).toEqual([]);
    expect(data.habits).toEqual([]);
  });
});
