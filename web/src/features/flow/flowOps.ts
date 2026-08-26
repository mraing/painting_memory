// 主流程数据操作（features/flow）—— 草稿 / 对话 / 收书 的纯数据层（§3.1 七步）。
// 全部断点落盘（§3.2）：草稿表存照片+阶段+转换产物+解读+日记；对话表可续聊。

import { db, type BookPage, type ChatMessage, type Conversation, type Draft } from '../../db/db';

/** 生成本地唯一 id（crypto.randomUUID 优先，老环境回退时间戳+随机） */
export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// —— 草稿 ——

/** 新建草稿：照片原样入库存（EXIF 方向归一化由立绘管线内部完成，见 docs/pipeline.md §4.1） */
export async function createDraft(photoBlob: Blob): Promise<Draft> {
  const draft: Draft = {
    id: newId(),
    photoBlob,
    capturedAt: Date.now(),
    stage: 'captured',
  };
  await db.drafts.put(draft);
  return draft;
}

export async function getDraftById(id: string | undefined | null): Promise<Draft | null> {
  if (!id) return null;
  return (await db.drafts.get(id)) ?? null;
}

/** 取最近一份未完成草稿（收进书后草稿即删除，故存在即未完成） */
export async function getLatestDraft(): Promise<Draft | null> {
  return (await db.drafts.orderBy('capturedAt').reverse().first()) ?? null;
}

/** 恢复主流程：优先 URL 指定的草稿，否则最近未完成草稿；都没有 → null（页面引导回 /capture） */
export async function getActiveDraft(preferredId?: string | null): Promise<Draft | null> {
  const preferred = await getDraftById(preferredId);
  return preferred ?? (await getLatestDraft());
}

/** 局部更新草稿（stage/转换产物/解读/日记等），断点续跑用 */
export async function patchDraft(
  id: string,
  patch: Partial<Pick<Draft, 'stage' | 'cutoutConfig' | 'layers' | 'interpretation' | 'diaryText'>>,
): Promise<Draft> {
  const draft = await db.drafts.get(id);
  if (!draft) throw new Error('草稿不存在，可能已收进书');
  const next: Draft = { ...draft, ...patch };
  await db.drafts.put(next);
  return next;
}

/** 收进书后移除草稿（连带其引导对话，避免孤儿数据常驻 conversations 表） */
export async function removeDraft(id: string): Promise<void> {
  await db.drafts.delete(id);
  await db.conversations.where('draftId').equals(id).delete();
}

// —— 引导对话（可续聊，§3.2）——

/** 取某草稿的对话记录（无则建新会话） */
export async function getOrCreateConversation(draftId: string): Promise<Conversation> {
  const existing = await db.conversations.where('draftId').equals(draftId).first();
  if (existing) return existing;
  const conv: Conversation = {
    id: newId(),
    draftId,
    messages: [],
    status: 'active',
    updatedAt: Date.now(),
  };
  await db.conversations.put(conv);
  return conv;
}

/** 追加一条消息并落盘（每次消息都持久化，中途退出可续聊） */
export async function appendMessage(
  conv: Conversation,
  msg: Omit<ChatMessage, 'at'>,
): Promise<Conversation> {
  const next: Conversation = {
    ...conv,
    messages: [...conv.messages, { ...msg, at: Date.now() }],
    updatedAt: Date.now(),
  };
  await db.conversations.put(next);
  return next;
}

/** 收束：把会话标记为 finished（写好啦） */
export async function finishConversation(conv: Conversation): Promise<Conversation> {
  const next: Conversation = { ...conv, status: 'finished', updatedAt: Date.now() };
  await db.conversations.put(next);
  return next;
}

// —— 收进书（§3.1 第 6 步）——

/** 本地月份键 'YYYY-MM'（书按月分章，§2 决策 8；用本地时区） */
export function monthKeyOf(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** 草稿 → 书页记录（立绘图层 + 配置 + 日记 + 时间 + 月份） */
export async function pageFromDraft(draft: Draft): Promise<BookPage> {
  const page: BookPage = {
    id: newId(),
    month: monthKeyOf(),
    createdAt: Date.now(),
    config: draft.cutoutConfig ?? {},
    layers: {
      foreground: draft.layers?.foreground,
      midground: draft.layers?.midground,
      backdrop: draft.layers?.backdrop,
      background: draft.layers?.background,
      base: draft.layers?.base,
      shadow: draft.layers?.shadow,
    },
    diary: draft.diaryText ?? '',
    interpretation: draft.interpretation,
  };
  await db.pages.put(page);
  return page;
}
