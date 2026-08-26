// 冒烟测试：Dexie 五张表可读写（fake-indexeddb 顶替浏览器 IndexedDB）
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Draft, type Conversation, type BookPage } from './db';

beforeEach(async () => {
  await Promise.all([
    db.drafts.clear(),
    db.conversations.clear(),
    db.pages.clear(),
    db.profile.clear(),
    db.settings.clear(),
  ]);
});

describe('Dexie 存储（§5.3 五表）', () => {
  it('drafts 可写入并读回', async () => {
    const draft: Draft = {
      id: 'd1',
      photoBlob: new Blob(['photo'], { type: 'image/jpeg' }),
      capturedAt: Date.now(),
      stage: 'captured',
    };
    await db.drafts.put(draft);
    const got = await db.drafts.get('d1');
    expect(got?.stage).toBe('captured');
    expect(got?.photoBlob.size).toBeGreaterThan(0);
  });

  it('conversations 可续聊追加', async () => {
    const conv: Conversation = {
      id: 'c1',
      draftId: 'd1',
      messages: [{ role: 'ai', text: '画面里那只小家伙，是狗狗吧？', at: Date.now() }],
      status: 'active',
      updatedAt: Date.now(),
    };
    await db.conversations.put(conv);
    conv.messages.push({ role: 'user', text: '是猫啦', at: Date.now() });
    await db.conversations.put(conv);
    const got = await db.conversations.get('c1');
    expect(got?.messages).toHaveLength(2);
    expect(got?.messages[1].text).toBe('是猫啦');
  });

  it('pages 可按月份查询', async () => {
    const page: BookPage = {
      id: 'p1',
      month: '2026-08',
      createdAt: Date.now(),
      config: { parallax: 0.3 },
      layers: { foreground: new Blob(['fg']), background: new Blob(['bg']) },
      diary: '那天你……',
    };
    await db.pages.put(page);
    const list = await db.pages.where('month').equals('2026-08').toArray();
    expect(list).toHaveLength(1);
    expect(list[0].diary).toContain('那天');
  });

  it('profile / settings 可读写', async () => {
    await db.profile.put({
      id: 'me',
      data: { user: { selfLabel: '我', naming: '你' } },
      updatedAt: new Date().toISOString(),
    });
    await db.settings.put({ key: 'deviceToken', value: 'tok-123' });
    expect((await db.profile.get('me'))?.id).toBe('me');
    expect((await db.settings.get('deviceToken'))?.value).toBe('tok-123');
  });
});
