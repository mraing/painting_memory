// 按月分章（§2 决策 8）—— 纯函数，便于单测。
// 章按首次出现顺序排列；章节跳转 = 跳到章首页。

import type { BookChapter } from './types';

/** 按月分章：返回章首下标与各章页数（保持首次出现顺序） */
export function groupChapters(months: string[]): BookChapter[] {
  const first = new Map<string, number>();
  const count = new Map<string, number>();
  months.forEach((month, i) => {
    if (!first.has(month)) first.set(month, i);
    count.set(month, (count.get(month) ?? 0) + 1);
  });
  return [...first.entries()].map(([month, index]) => ({
    month,
    index,
    count: count.get(month) ?? 0,
  }));
}

/** '2026-06' → '2026.06'（书内/页签短标签） */
export function monthShort(month: string): string {
  return month.replace('-', '.');
}

const CN_MONTHS = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
];

/** '2026-06' → '六月'（章节签） */
export function monthCn(month: string): string {
  const n = Number(month.split('-')[1]);
  return CN_MONTHS[n - 1] ?? month;
}
