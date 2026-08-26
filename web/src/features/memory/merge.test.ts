// 确定性合并算法测试 —— development.md §8.4 各分支：新增 / 合并 / 冲突 / 裁剪 / 上限
import { describe, expect, it } from 'vitest';
import { createEmptyProfile, type Profile, type ProfileCandidate } from './types';
import {
  mergeProfile,
  PROFILE_LIST_CAP,
  TRAITS_CAP,
  NOTES_CAP,
  MAX_NOTE_LEN,
} from './merge';

function profile(partial?: Partial<Profile>): Profile {
  return { ...createEmptyProfile(), ...partial };
}

describe('mergeProfile 新增实体', () => {
  it('person 新实体追加：count=1、traits 初始化、lastSeen 取候选 date', () => {
    const p = profile();
    mergeProfile(p, [
      { kind: 'person', name: '妈妈', relation: '母亲', trait: '做菜很好吃', date: '2026-08-25' },
    ]);
    expect(p.people).toHaveLength(1);
    expect(p.people[0]).toMatchObject({
      name: '妈妈',
      relation: '母亲',
      traits: ['做菜很好吃'],
      count: 1,
      lastSeen: '2026-08-25',
    });
  });

  it('place / preference / importantDate / habit 新实体追加', () => {
    const p = profile();
    mergeProfile(p, [
      { kind: 'place', name: '外婆家', meaning: '童年的记忆', date: '2026-08-25' },
      { kind: 'preference', topic: '雨天', note: '喜欢雨后的空气' },
      { kind: 'importantDate', date: '2026-06-01', note: '搬家到新城市的第一天' },
      { kind: 'habit', topic: '叙述习惯', note: '讲故事时喜欢先交代天气' },
    ]);
    expect(p.places[0]).toMatchObject({ name: '外婆家', meaning: '童年的记忆', count: 1 });
    expect(p.preferences[0]).toMatchObject({ topic: '雨天', note: '喜欢雨后的空气', count: 1 });
    expect(p.importantDates[0]).toMatchObject({ date: '2026-06-01', note: '搬家到新城市的第一天' });
    expect(p.habits[0]).toMatchObject({ topic: '叙述习惯', note: '讲故事时喜欢先交代天气' });
  });

  it('date 缺省时 lastSeen 取当天', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'person', name: '爸爸' }]);
    expect(p.people[0].lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('合并后 updatedAt 刷新为 ISO 时间戳', () => {
    const p = profile();
    const before = p.updatedAt;
    mergeProfile(p, [{ kind: 'person', name: '妈妈' }]);
    expect(p.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(p.updatedAt >= before).toBe(true);
  });
});

describe('mergeProfile 同实体合并', () => {
  it('同名归一化匹配（去空白/小写）→ count+1、lastSeen 更新', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'person', name: '妈妈', date: '2026-08-01' }]);
    mergeProfile(p, [{ kind: 'person', name: ' 妈妈 ', date: '2026-08-25' }]);
    expect(p.people).toHaveLength(1);
    expect(p.people[0].count).toBe(2);
    expect(p.people[0].lastSeen).toBe('2026-08-25');
  });

  it('traits 并集：互补保留、重复去重（归一化匹配）', () => {
    const p = profile();
    mergeProfile(p, [
      { kind: 'person', name: '妈妈', trait: '做菜很好吃' },
      { kind: 'person', name: '妈妈', trait: '怕猫' },
      { kind: 'person', name: '妈妈', trait: '做菜很好吃' },
    ]);
    expect(p.people[0].traits).toEqual(['做菜很好吃', '怕猫']);
    expect(p.people[0].count).toBe(3);
  });

  it('同一批 candidates 内自相撞也按同规则归并', () => {
    const p = profile();
    mergeProfile(p, [
      { kind: 'person', name: '狗', relation: '宠物', trait: '很乖' },
      { kind: 'person', name: '狗', relation: '宠物', trait: '爱撒娇' },
    ]);
    expect(p.people).toHaveLength(1);
    expect(p.people[0].count).toBe(2);
    expect(p.people[0].traits).toEqual(['很乖', '爱撒娇']);
  });

  it('同 topic 偏好合并 count+1', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'preference', topic: '雨天', note: '喜欢雨后的空气' }]);
    mergeProfile(p, [{ kind: 'preference', topic: '雨天', note: '喜欢雨后的空气' }]);
    expect(p.preferences).toHaveLength(1);
    expect(p.preferences[0].count).toBe(2);
  });
});

describe('mergeProfile 冲突处理（§8.4：保留 count 更高者，低者降级为备注）', () => {
  it('person 关系冲突：既有关系保留，候选关系进 notes', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'person', name: '妈妈', relation: '母亲', date: '2026-01-01' }]);
    mergeProfile(p, [{ kind: 'person', name: '妈妈', relation: '恋人', date: '2026-08-25' }]);
    expect(p.people[0].relation).toBe('母亲');
    expect(p.people[0].notes).toEqual(['恋人']);
    expect(p.people[0].count).toBe(2);
  });

  it('place 意义冲突：既有 meaning 保留，候选降级为备注', () => {
    const p = profile();
    mergeProfile(p, [
      { kind: 'place', name: '外婆家', meaning: '童年的记忆', date: '2026-01-01' },
    ]);
    mergeProfile(p, [
      { kind: 'place', name: '外婆家', meaning: '现在住的地方', date: '2026-08-25' },
    ]);
    expect(p.places[0].meaning).toBe('童年的记忆');
    expect(p.places[0].notes).toEqual(['现在住的地方']);
  });

  it('preference 描述冲突：既有 note 保留，候选降级为备注', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'preference', topic: '雨天', note: '喜欢雨后的空气' }]);
    mergeProfile(p, [{ kind: 'preference', topic: '雨天', note: '讨厌下雨天' }]);
    expect(p.preferences[0].note).toBe('喜欢雨后的空气');
    expect(p.preferences[0].notes).toEqual(['讨厌下雨天']);
    expect(p.preferences[0].count).toBe(2);
  });

  it('同值不视为冲突（归一化相同则跳过）', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'place', name: '老家', meaning: '童年的记忆' }]);
    mergeProfile(p, [{ kind: 'place', name: '老家', meaning: '童年 的记忆' }]);
    expect(p.places[0].notes).toBeUndefined();
  });

  it('importantDate 同日不同注：并存拼接（无 count 可比）', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'importantDate', date: '2026-06-01', note: '搬家第一天' }]);
    mergeProfile(p, [{ kind: 'importantDate', date: '2026-06-01', note: '新工作开始' }]);
    expect(p.importantDates[0].note).toBe('搬家第一天；新工作开始');
    expect(p.importantDates).toHaveLength(1);
  });

  it('habit 同 topic 不同注：并存拼接', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'habit', topic: '叙述习惯', note: '先交代天气' }]);
    mergeProfile(p, [{ kind: 'habit', topic: '叙述习惯', note: '喜欢用短句' }]);
    expect(p.habits[0].note).toBe('先交代天气；喜欢用短句');
  });

  it('notes 去重（归一化）', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'person', name: '妈妈', relation: '母亲' }]);
    mergeProfile(p, [{ kind: 'person', name: '妈妈', relation: '恋人' }]);
    mergeProfile(p, [{ kind: 'person', name: '妈妈', relation: '恋人' }]);
    expect(p.people[0].notes).toEqual(['恋人']);
  });
});

describe('mergeProfile 膨胀裁剪与上限', () => {
  it('列表超 200 项 → 按 count 降序裁剪', () => {
    const p = profile();
    for (let i = 0; i < 205; i++) {
      p.people.push({ name: `人${i}`, traits: [], count: 1, lastSeen: '2026-01-01' });
    }
    // 抬高两条的 count，验证裁剪保留高 count 者
    p.people[0].count = 9;
    p.people[1].count = 8;
    mergeProfile(p, []);
    expect(p.people.length).toBe(PROFILE_LIST_CAP);
    expect(p.people.some((x) => x.name === '人0' && x.count === 9)).toBe(true);
    expect(p.people.some((x) => x.name === '人1' && x.count === 8)).toBe(true);
    expect(p.people.every((x) => x.count >= 1)).toBe(true);
  });

  it('同 count 时按 lastSeen 新者优先（recency 决胜）', () => {
    const p = profile();
    for (let i = 0; i < 198; i++) {
      p.people.push({ name: `常客${i}`, traits: [], count: 3, lastSeen: '2026-08-01' });
    }
    p.people.push({ name: '旧识', traits: [], count: 1, lastSeen: '2020-01-01' });
    p.people.push({ name: '新识', traits: [], count: 1, lastSeen: '2026-08-25' });
    p.people.push({ name: '常客C', traits: [], count: 2, lastSeen: '2026-01-01' });
    expect(p.people.length).toBe(201);
    mergeProfile(p, []);
    expect(p.people.length).toBe(PROFILE_LIST_CAP);
    const names = p.people.map((x) => x.name);
    expect(names).toContain('新识'); // count 1 中 lastSeen 更新者留下（恰好是第 200 位）
    expect(names).not.toContain('旧识'); // 同 count 按 recency 淘汰
    expect(names).toContain('常客C'); // count 2 优先于 count 1
  });

  it('preferences 无 lastSeen，仅按 count 裁剪', () => {
    const p = profile();
    for (let i = 0; i < 205; i++) {
      p.preferences.push({ topic: `偏好${i}`, note: 'x', count: 1 });
    }
    p.preferences[0].count = 5;
    mergeProfile(p, []);
    expect(p.preferences.length).toBe(PROFILE_LIST_CAP);
    expect(p.preferences[0].topic).toBe('偏好0');
  });

  it('traits 并集上限 20 条', () => {
    const p = profile();
    const candidates: ProfileCandidate[] = [];
    for (let i = 0; i < TRAITS_CAP + 5; i++) {
      candidates.push({ kind: 'person', name: '妈妈', trait: `特质${i}` });
    }
    mergeProfile(p, candidates);
    expect(p.people[0].traits.length).toBe(TRAITS_CAP);
  });

  it('notes 上限 5 条（保留最近 5 条冲突备注）', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'person', name: '妈妈', relation: '母亲' }]);
    for (let i = 0; i < NOTES_CAP + 3; i++) {
      mergeProfile(p, [{ kind: 'person', name: '妈妈', relation: `说法${i}` }]);
    }
    expect(p.people[0].notes!.length).toBe(NOTES_CAP);
    expect(p.people[0].notes).toEqual(['说法3', '说法4', '说法5', '说法6', '说法7']);
  });

  it('importantDate 拼接超 120 字截断', () => {
    const p = profile();
    mergeProfile(p, [{ kind: 'importantDate', date: '2026-06-01', note: '长'.repeat(80) }]);
    mergeProfile(p, [{ kind: 'importantDate', date: '2026-06-01', note: '短'.repeat(80) }]);
    expect(p.importantDates[0].note.length).toBeLessThanOrEqual(MAX_NOTE_LEN);
    expect(p.importantDates[0].note.endsWith('…')).toBe(true);
  });
});

describe('mergeProfile 行为契约', () => {
  it('原地修改并返回同一对象（便于调用方链式使用）', () => {
    const p = profile();
    const ret = mergeProfile(p, [{ kind: 'person', name: '妈妈' }]);
    expect(ret).toBe(p);
    expect(p.people).toHaveLength(1);
  });

  it('空 candidates 也是合法调用（仅刷新 updatedAt + 裁剪）', () => {
    const p = profile();
    const before = p.updatedAt;
    mergeProfile(p, []);
    expect(p.people).toHaveLength(0);
    expect(p.updatedAt >= before).toBe(true);
  });
});

describe('mergeProfile 演化场景（fixture 对话 → 画像演化）', () => {
  it('连续两次日记会话后画像按预期演化', () => {
    const p = profile();
    // 会话一：妈妈 + 外婆家
    mergeProfile(p, [
      { kind: 'person', name: '妈妈', relation: '母亲', trait: '做菜很好吃', date: '2026-08-01' },
      { kind: 'place', name: '外婆家', meaning: '童年暑假的记忆', date: '2026-08-01' },
    ]);
    // 会话二：再次提到妈妈（新 trait）+ 新偏好
    mergeProfile(p, [
      { kind: 'person', name: '妈妈', relation: '母亲', trait: '怕猫', date: '2026-08-25' },
      { kind: 'preference', topic: '雨天', note: '喜欢雨后的空气' },
    ]);
    expect(p.people).toHaveLength(1);
    expect(p.people[0].count).toBe(2);
    expect(p.people[0].lastSeen).toBe('2026-08-25');
    expect(p.people[0].traits).toEqual(['做菜很好吃', '怕猫']);
    expect(p.people[0].notes).toBeUndefined();
    expect(p.places[0].count).toBe(1);
    expect(p.preferences[0].count).toBe(1);
  });
});
