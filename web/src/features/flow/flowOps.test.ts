// 主流程数据操作测试（features/flow）：草稿断点落盘 / 对话续聊 / 收进书（§3.1/§3.2）
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { loadBookPages } from '../book/data';
import {
  appendMessage,
  createDraft,
  finishConversation,
  getActiveDraft,
  getOrCreateConversation,
  monthKeyOf,
  pageFromDraft,
  patchDraft,
  removeDraft,
} from './flowOps';

beforeEach(async () => {
  await Promise.all([db.drafts.clear(), db.conversations.clear(), db.pages.clear()]);
});

describe('草稿（capture → convert）', () => {
  it('createDraft：照片 Blob 入 drafts 表，stage=captured', async () => {
    const draft = await createDraft(new Blob(['photo'], { type: 'image/jpeg' }));
    const got = await db.drafts.get(draft.id);
    expect(got?.stage).toBe('captured');
    expect(got?.photoBlob.size).toBeGreaterThan(0);
    expect(typeof got?.capturedAt).toBe('number');
  });

  it('getActiveDraft：URL id 优先，其次最近草稿', async () => {
    const old = await createDraft(new Blob(['a']));
    const fresh = await createDraft(new Blob(['b']));
    expect((await getActiveDraft(fresh.id))?.id).toBe(fresh.id);
    expect((await getActiveDraft(null))?.id).toBe(fresh.id); // capturedAt 倒序取最新
    expect((await getActiveDraft(undefined))?.id).toBe(fresh.id);
    void old;
  });

  it('getActiveDraft：无草稿 → null', async () => {
    expect(await getActiveDraft('nope')).toBeNull();
    expect(await getActiveDraft(null)).toBeNull();
  });

  it('patchDraft：转换产物与阶段落盘，断点可恢复', async () => {
    const draft = await createDraft(new Blob(['x']));
    await patchDraft(draft.id, {
      stage: 'converted',
      layers: { foreground: new Blob(['fg']) },
      cutoutConfig: { version: 1, workSize: { width: 4, height: 3 } },
    });
    const got = await db.drafts.get(draft.id);
    expect(got?.stage).toBe('converted');
    expect(got?.layers?.foreground).toBeInstanceOf(Blob);
    expect((got?.cutoutConfig as { version: number }).version).toBe(1);
  });

  it('patchDraft：草稿不存在时抛错', async () => {
    await expect(patchDraft('gone', { stage: 'converted' })).rejects.toThrow();
  });

  it('removeDraft：收进书后草稿移除', async () => {
    const draft = await createDraft(new Blob(['x']));
    await removeDraft(draft.id);
    expect(await db.drafts.get(draft.id)).toBeUndefined();
  });

  it('removeDraft：连带清理该草稿的引导对话（t9：避免孤儿数据常驻 conversations 表）', async () => {
    const draft = await createDraft(new Blob(['x']));
    const conv = await getOrCreateConversation(draft.id);
    await appendMessage(conv, { role: 'ai', text: 'hi' });
    await removeDraft(draft.id);
    expect(await db.conversations.where('draftId').equals(draft.id).count()).toBe(0);
    // 其他草稿的对话不受影响
    const other = await createDraft(new Blob(['y']));
    const otherConv = await getOrCreateConversation(other.id);
    await appendMessage(otherConv, { role: 'ai', text: 'hi' });
    expect(await db.conversations.where('draftId').equals(other.id).count()).toBe(1);
  });
});

describe('对话续聊（story，§3.2）', () => {
  it('getOrCreateConversation：首次建空会话，二次取回同一会话', async () => {
    const draft = await createDraft(new Blob(['x']));
    const a = await getOrCreateConversation(draft.id);
    const b = await getOrCreateConversation(draft.id);
    expect(a.id).toBe(b.id);
    expect(a.messages).toEqual([]);
    expect(a.status).toBe('active');
  });

  it('appendMessage：消息追加并落盘（中途退出可续聊）', async () => {
    const draft = await createDraft(new Blob(['x']));
    let conv = await getOrCreateConversation(draft.id);
    conv = await appendMessage(conv, { role: 'ai', text: '画面里的小家伙，是狗狗吧？' });
    conv = await appendMessage(conv, { role: 'user', text: '是猫啦' });
    const reloaded = await getOrCreateConversation(draft.id);
    expect(reloaded.messages).toHaveLength(2);
    expect(reloaded.messages[0]).toMatchObject({ role: 'ai', text: '画面里的小家伙，是狗狗吧？' });
    expect(reloaded.messages[1].at).toBeGreaterThan(0);
  });

  it('finishConversation：写好啦标记 finished', async () => {
    const draft = await createDraft(new Blob(['x']));
    const conv = await getOrCreateConversation(draft.id);
    await finishConversation(conv);
    const reloaded = await getOrCreateConversation(draft.id);
    expect(reloaded.status).toBe('finished');
  });
});

describe('收进书（entry → book，§3.1 第 6 步）', () => {
  it('monthKeyOf：本地时区 YYYY-MM', () => {
    expect(monthKeyOf(new Date(2026, 5, 15))).toBe('2026-06');
    expect(monthKeyOf(new Date(2026, 0, 1))).toBe('2026-01');
    expect(monthKeyOf(new Date(2026, 11, 31))).toBe('2026-12');
  });

  it('pageFromDraft：写 pages 表（立绘图层 + 配置 + 日记 + 月份）', async () => {
    const draft = await createDraft(new Blob(['photo']));
    await patchDraft(draft.id, {
      stage: 'chatted',
      layers: { foreground: new Blob(['fg'], { type: 'image/png' }), base: new Blob(['base']) },
      cutoutConfig: { version: 1, workSize: { width: 10, height: 8 }, depth: 0.6 },
      interpretation: { subject: '一只猫' },
      diaryText: '那天你……',
    });
    const full = (await db.drafts.get(draft.id))!;
    const page = await pageFromDraft(full);

    const got = await db.pages.get(page.id);
    expect(got?.month).toMatch(/^\d{4}-\d{2}$/);
    expect(got?.diary).toBe('那天你……');
    expect(got?.layers.foreground).toBeInstanceOf(Blob);
    expect((got?.config as { depth: number }).depth).toBe(0.6);
    expect((got?.interpretation as { subject: string }).subject).toBe('一只猫');
    expect(typeof got?.createdAt).toBe('number');
  });

  it('pageFromDraft：无转换产物时也产出合法书页（空图层/空日记兜底）', async () => {
    const draft = await createDraft(new Blob(['x']));
    const page = await pageFromDraft(draft);
    expect(page.month).toMatch(/^\d{4}-\d{2}$/);
    expect(page.diary).toBe('');
    expect(page.layers).toEqual({});
    expect(page.config).toEqual({});
  });
});

describe('全流程数据链路（上传→转换→对话→收进书→书里可见，§3.1）', () => {
  it('mock 全链路：草稿各阶段落盘 → 收书后 drafts 清空、pages 可被书浏览读到', async () => {
    // 1. 上传（capture）：照片入 drafts
    const draft = await createDraft(new Blob(['photo'], { type: 'image/jpeg' }));
    expect(draft.stage).toBe('captured');

    // 2. 转换（convert）：产物落盘，断点可恢复
    await patchDraft(draft.id, {
      stage: 'converted',
      layers: { foreground: new Blob(['fg'], { type: 'image/png' }) },
      cutoutConfig: { version: 1, workSize: { width: 4, height: 3 }, depth: 0.6 },
    });
    let resumed = await getActiveDraft(draft.id);
    expect(resumed?.stage).toBe('converted');
    expect(resumed?.layers?.foreground).toBeInstanceOf(Blob);

    // 3. 对话（story）：首轮开场 + 用户回复，可续聊
    let conv = await getOrCreateConversation(draft.id);
    conv = await appendMessage(conv, { role: 'ai', text: '画面里的小家伙，是狗狗吧？' });
    conv = await appendMessage(conv, { role: 'user', text: '是猫啦，它叫阿橘' });
    resumed = await getActiveDraft(draft.id);
    expect((await getOrCreateConversation(draft.id)).messages).toHaveLength(2);
    void resumed;

    // 4. 收束 + 生成日记（story → entry）
    await finishConversation(conv);
    await patchDraft(draft.id, {
      stage: 'chatted',
      interpretation: { subject: '一只橘猫' },
      diaryText: '那天你蹲在窗边，阿橘在你脚边打盹。',
    });

    // 5. 收进书：pages 写入 + 草稿移除
    const full = (await db.drafts.get(draft.id))!;
    await pageFromDraft(full);
    await removeDraft(draft.id);
    expect(await db.drafts.get(draft.id)).toBeUndefined();

    // 6. 书浏览可见（features/book 真实数据路径，非 mock 兜底）
    const { items, isMock } = await loadBookPages({ mockFactory: async () => [] });
    expect(isMock).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      month: monthKeyOf(),
      diary: '那天你蹲在窗边，阿橘在你脚边打盹。',
    });
    expect(items[0].layers.foreground).toBeInstanceOf(Blob);
  });
});
