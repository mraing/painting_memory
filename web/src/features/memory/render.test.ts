// 注入渲染测试 —— §8.4：画像 → 自然语言段落 + 最近 3~5 篇日记截断拼接
import { describe, expect, it } from 'vitest';
import { renderMemory, renderProfileForPrompt, RECENT_DIARY_LIMIT, DIARY_SNIPPET_LEN } from './render';
import { createEmptyProfile } from './types';

describe('renderMemory 画像渲染', () => {
  it('无画像且无日记 → 空字符串', () => {
    expect(renderMemory(null, [])).toBe('');
    expect(renderMemory(createEmptyProfile(), [])).toBe('');
  });

  it('画像渲染为自然语言段落（人物/地点/偏好/日期/习惯）', () => {
    const p = createEmptyProfile();
    p.people.push({ name: '妈妈', relation: '母亲', traits: ['做菜很好吃', '拿手菜是红烧肉'], count: 3, lastSeen: '2026-08-25' });
    p.places.push({ name: '外婆家的老院子', meaning: '童年暑假的记忆', count: 2, lastSeen: '2026-08-01' });
    p.preferences.push({ topic: '雨天', note: '喜欢雨后的空气', count: 5 });
    p.importantDates.push({ date: '2026-06-01', note: '搬家到新城市的第一天' });
    p.habits.push({ topic: '叙述习惯', note: '讲故事时喜欢先交代天气' });

    const out = renderMemory(p, []);
    expect(out).toContain('关于 TA 的记忆：');
    expect(out).toContain('妈妈（母亲；做菜很好吃，拿手菜是红烧肉；最近 3 次提到）');
    expect(out).toContain('外婆家的老院子（童年暑假的记忆；最近 2 次提到）');
    expect(out).toContain('雨天：喜欢雨后的空气（5 次提到）');
    expect(out).toContain('2026-06-01：搬家到新城市的第一天');
    expect(out).toContain('叙述习惯：讲故事时喜欢先交代天气');
  });

  it('count=1 的偏好不重复标注次数', () => {
    const p = createEmptyProfile();
    p.preferences.push({ topic: '雨天', note: '喜欢雨后的空气', count: 1 });
    const out = renderMemory(p, []);
    expect(out).toContain('雨天：喜欢雨后的空气');
    expect(out).not.toContain('1 次提到');
  });

  it('冲突备注以「另有说法」渲染（信息不丢失）', () => {
    const p = createEmptyProfile();
    p.people.push({ name: '妈妈', relation: '母亲', traits: [], count: 2, notes: ['恋人'] });
    p.preferences.push({ topic: '雨天', note: '喜欢雨后的空气', count: 2, notes: ['讨厌下雨天'] });
    const out = renderMemory(p, []);
    expect(out).toContain('妈妈（母亲；最近 2 次提到；另有说法：恋人）');
    expect(out).toContain('另有说法：讨厌下雨天');
  });

  it('traits 只渲染前 3 条（token 预算）', () => {
    const p = createEmptyProfile();
    p.people.push({
      name: '妈妈',
      relation: '母亲',
      traits: ['t1', 't2', 't3', 't4', 't5'],
      count: 1,
    });
    const out = renderMemory(p, []);
    expect(out).toContain('t1，t2，t3');
    expect(out).not.toContain('t4');
  });
});

describe('renderMemory 近期日记注入', () => {
  it('最多拼接 5 篇（超出截断）', () => {
    const diaries = Array.from({ length: 8 }, (_, i) => `日记${i}`);
    const out = renderMemory(null, diaries);
    expect(out).toContain('最近的日记：');
    expect(out.match(/「日记\d」/g)?.length).toBe(5);
  });

  it('单篇超 300 字截断并加省略号', () => {
    const long = '长'.repeat(DIARY_SNIPPET_LEN + 50);
    const out = renderMemory(null, [long]);
    expect(out).toContain(`${'长'.repeat(DIARY_SNIPPET_LEN)}……`);
  });

  it('画像段与日记段分行拼接', () => {
    const p = createEmptyProfile();
    p.people.push({ name: '妈妈', relation: '母亲', traits: [], count: 1 });
    const out = renderMemory(p, ['那天阳光很好']);
    const lines = out.split('\n');
    expect(lines[0]).toContain('关于 TA 的记忆');
    expect(lines[1]).toContain('最近的日记：「那天阳光很好」');
  });
});

describe('renderProfileForPrompt 兼容旧名', () => {
  it('与 renderMemory 等价', () => {
    const p = createEmptyProfile();
    p.people.push({ name: '妈妈', relation: '母亲', traits: [], count: 1 });
    expect(renderProfileForPrompt(p, ['d'])).toBe(renderMemory(p, ['d']));
    expect(RECENT_DIARY_LIMIT).toBe(5);
  });
});
