// 书数据层测试：pages 表 → 浏览条目映射 / mock 兜底 / 删除（§9）
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { loadBookPages, deleteBookPage } from './data';
import type { BookPageItem } from './types';

beforeEach(async () => {
  await db.pages.clear();
});

const stubMockFactory = async (): Promise<BookPageItem[]> => [
  { id: 'mock-1', month: '2026-04', image: 'data:image/png;base64,x', diary: '演示日记', layers: {} },
  { id: 'mock-2', month: '2026-04', image: 'data:image/png;base64,y', diary: '第二页', layers: {} },
];

describe('loadBookPages', () => {
  it('pages 表为空 → mock 兜底（t6 未完成前的开发数据）', async () => {
    const { items, isMock } = await loadBookPages({ mockFactory: stubMockFactory });
    expect(isMock).toBe(true);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'mock-1', month: '2026-04', diary: '演示日记' });
  });

  it('pages 表有真实数据 → 映射为浏览条目，按 createdAt 升序（最新页在末位）', async () => {
    await db.pages.put({
      id: 'p1',
      month: '2026-05',
      createdAt: 1000,
      config: {},
      layers: {},
      diary: '那天你……',
    });
    await db.pages.put({
      id: 'p2',
      month: '2026-06',
      createdAt: 2000,
      config: {},
      layers: {},
      diary: '另一页',
    });
    const { items, isMock } = await loadBookPages({ mockFactory: stubMockFactory });
    expect(isMock).toBe(false);
    expect(items.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(items[0]).toMatchObject({ month: '2026-05', diary: '那天你……' });
    expect(items[1].month).toBe('2026-06');
  });

  it('真实页无图层 → 页图为 null（浏览层显示空白纸）；有图层 → 透传 Blob', async () => {
    await db.pages.put({
      id: 'p1',
      month: '2026-05',
      createdAt: 1000,
      config: {},
      layers: {},
      diary: '无图层页',
    });
    await db.pages.put({
      id: 'p2',
      month: '2026-06',
      createdAt: 2000,
      config: {},
      layers: { foreground: new Blob(['fg'], { type: 'image/png' }) },
      diary: '有图层页',
    });
    const { items } = await loadBookPages({ mockFactory: stubMockFactory });
    // node 环境无 canvas：合成失败 → 均回落 null；图层 Blob 仍透传到单页 3D 层
    expect(items[0].image).toBeNull();
    expect(items[1].image).toBeNull();
    expect(items[1].layers.foreground).toBeInstanceOf(Blob);
  });

  it('真实页存在时不走 mock 兜底', async () => {
    await db.pages.put({
      id: 'p1',
      month: '2026-05',
      createdAt: 1000,
      config: {},
      layers: {},
      diary: '真实页',
    });
    const { items, isMock } = await loadBookPages({ mockFactory: stubMockFactory });
    expect(isMock).toBe(false);
    expect(items[0].id).toBe('p1');
    expect(items.some((p) => p.id === 'mock-1')).toBe(false);
  });
});

describe('deleteBookPage（§9 仅保留删除）', () => {
  it('删除后 pages 表不再包含该页', async () => {
    await db.pages.put({
      id: 'p1',
      month: '2026-05',
      createdAt: 1000,
      config: {},
      layers: {},
      diary: '要删的页',
    });
    await db.pages.put({
      id: 'p2',
      month: '2026-06',
      createdAt: 2000,
      config: {},
      layers: {},
      diary: '留着的页',
    });
    await deleteBookPage('p1');
    expect(await db.pages.get('p1')).toBeUndefined();
    expect(await db.pages.get('p2')).toBeDefined();
  });

  it('删除不存在的 id 静默成功', async () => {
    await expect(deleteBookPage('nope')).resolves.toBeUndefined();
  });
});
