// 按月分章测试（§2 决策 8：一本总书、按月分章）
import { describe, expect, it } from 'vitest';
import { groupChapters, monthCn, monthShort } from './chapters';

describe('groupChapters 按月分章', () => {
  it('按首次出现顺序分章，记录章首下标与页数', () => {
    const chapters = groupChapters([
      '2026-04',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-06',
      '2026-06',
    ]);
    expect(chapters).toEqual([
      { month: '2026-04', index: 0, count: 2 },
      { month: '2026-05', index: 2, count: 1 },
      { month: '2026-06', index: 3, count: 3 },
    ]);
  });

  it('单页书 → 单章', () => {
    expect(groupChapters(['2026-06'])).toEqual([{ month: '2026-06', index: 0, count: 1 }]);
  });

  it('空列表 → 空章节', () => {
    expect(groupChapters([])).toEqual([]);
  });

  it('章首下标可用于跳转定位', () => {
    const chapters = groupChapters(['2026-04', '2026-05', '2026-05', '2026-05']);
    // 跳到第二章首页 = 下标 1
    expect(chapters[1].index).toBe(1);
  });
});

describe('月份标签', () => {
  it('monthShort：把 2026-06 转成 2026.06', () => {
    expect(monthShort('2026-06')).toBe('2026.06');
    expect(monthShort('2026-11')).toBe('2026.11');
  });

  it('monthCn：把 2026-06 转成 六月', () => {
    expect(monthCn('2026-01')).toBe('一月');
    expect(monthCn('2026-06')).toBe('六月');
    expect(monthCn('2026-12')).toBe('十二月');
  });

  it('非法月份原样返回', () => {
    expect(monthCn('2026-13')).toBe('2026-13');
    expect(monthCn('未知')).toBe('未知');
  });
});
