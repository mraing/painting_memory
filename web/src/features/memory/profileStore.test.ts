// 画像 store 与注入装配测试 —— Dexie 持久化 + 接入点（§8.4）
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { useProfileStore } from './profileStore';
import { buildChatInjection, getRecentDiarySnippets } from './inject';
import { renderMemory } from './render';
import { createEmptyProfile } from './types';

beforeEach(async () => {
  await Promise.all([db.profile.clear(), db.pages.clear()]);
  useProfileStore.setState({ profile: null, loaded: false });
});

describe('profileStore 持久化', () => {
  it('首次 load 创建空画像并落库', async () => {
    const p = await useProfileStore.getState().load();
    expect(p.user.selfLabel).toBe('我');
    expect(useProfileStore.getState().loaded).toBe(true);
    expect(await db.profile.get('me')).toBeTruthy();
  });

  it('merge 后画像落库，二次 load 读回合并结果', async () => {
    const store = useProfileStore.getState();
    await store.load();
    await store.merge([
      { kind: 'person', name: '妈妈', relation: '母亲', trait: '做菜很好吃', date: '2026-08-25' },
      { kind: 'preference', topic: '雨天', note: '喜欢雨后的空气' },
    ]);
    // 重新从 IndexedDB 读回（模拟刷新页面）
    useProfileStore.setState({ profile: null, loaded: false });
    const reloaded = await useProfileStore.getState().load();
    expect(reloaded.people).toHaveLength(1);
    expect(reloaded.people[0]).toMatchObject({ name: '妈妈', count: 1, lastSeen: '2026-08-25' });
    expect(reloaded.preferences).toHaveLength(1);
  });

  it('merge 不污染 store 中正在渲染引用的旧对象', async () => {
    const store = useProfileStore.getState();
    const before = await store.load();
    await store.merge([{ kind: 'person', name: '妈妈' }]);
    // 旧引用仍是空画像（深拷贝合并），store 已指向新对象
    expect(before.people).toHaveLength(0);
    expect(useProfileStore.getState().profile!.people).toHaveLength(1);
  });

  it('applyDiaryExtraction：对话 → 提取 → 合并 → 入库（日记生成后接入点）', async () => {
    const store = useProfileStore.getState();
    await store.load();
    await store.applyDiaryExtraction(
      [
        { role: 'ai', text: '画面里的猫是你养的吧？' },
        { role: 'user', text: '对，我妈妈做菜很好吃，猫也特别粘人' },
      ],
      '2026-08-25',
    );
    const p = useProfileStore.getState().profile!;
    expect(p.people).toHaveLength(2); // 妈妈 + 猫
    const mom = p.people.find((x) => x.name === '妈妈');
    expect(mom).toMatchObject({ relation: '母亲', count: 1, lastSeen: '2026-08-25' });
    // 再跑一次同一会话 → count 累加（幂等合并）
    await useProfileStore.getState().applyDiaryExtraction(
      [
        { role: 'ai', text: '画面里的猫是你养的吧？' },
        { role: 'user', text: '对，我妈妈做菜很好吃，猫也特别粘人' },
      ],
      '2026-08-26',
    );
    const mom2 = useProfileStore.getState().profile!.people.find((x) => x.name === '妈妈')!;
    expect(mom2.count).toBe(2);
    expect(mom2.lastSeen).toBe('2026-08-26');
  });

  it('applyDiaryExtraction：无可提取内容时不写库', async () => {
    const store = useProfileStore.getState();
    await store.load();
    const p = await store.applyDiaryExtraction([{ role: 'user', text: '今天只是晒了晒太阳' }]);
    expect(p.people).toHaveLength(0);
    expect(p.preferences).toHaveLength(0);
  });
});

describe('注入装配（inject.ts）', () => {
  it('getRecentDiarySnippets 取最近 5 篇（时间倒序）', async () => {
    for (let i = 0; i < 7; i++) {
      await db.pages.put({
        id: `p${i}`,
        month: '2026-08',
        createdAt: 1000 + i,
        config: {},
        layers: {},
        diary: `日记${i}`,
      });
    }
    const snippets = await getRecentDiarySnippets();
    expect(snippets).toHaveLength(5);
    expect(snippets[0]).toBe('日记6'); // 最新在前
    expect(snippets[4]).toBe('日记2');
  });

  it('buildChatInjection：画像 + 最近日记 → 自然语言注入段落', async () => {
    const store = useProfileStore.getState();
    await store.load();
    await store.merge([{ kind: 'person', name: '妈妈', relation: '母亲' }]);
    await db.pages.put({
      id: 'p1',
      month: '2026-08',
      createdAt: 1000,
      config: {},
      layers: {},
      diary: '那天阳光很好',
    });
    const { injection, profile, recentDiaries } = await buildChatInjection();
    expect(profile.people[0].name).toBe('妈妈');
    expect(recentDiaries).toEqual(['那天阳光很好']);
    const expected = renderMemory(profile, recentDiaries);
    expect(injection).toBe(expected);
    expect(injection).toContain('关于 TA 的记忆');
    expect(injection).toContain('最近的日记：「那天阳光很好」');
  });

  it('画像未加载时 buildChatInjection 自动 load', async () => {
    const { profile } = await buildChatInjection();
    expect(profile).toBeTruthy();
    expect(useProfileStore.getState().loaded).toBe(true);
    const expected = createEmptyProfile();
    expect({ ...profile, updatedAt: '' }).toEqual({ ...expected, updatedAt: '' });
  });
});
