// 注入装配 —— development.md §8.4 接入点：
// 对话（story）流程请求前调用 buildChatInjection() 把画像 + 最近 3~5 篇日记
// 渲染成自然语言段落注入；Mock 期由 features/ai 的 chat() 接收 profile/recentDiaries，
// 真后端期由服务端统一拼上下文（见 docs/api-contract.md POST /api/chat）。

import { db } from '../../db/db';
import type { Profile } from './types';
import { renderMemory, RECENT_DIARY_LIMIT } from './render';
import { useProfileStore } from './profileStore';

/** 最近 limit 篇日记正文（按创建时间倒序；供 chat 注入用） */
export async function getRecentDiarySnippets(limit: number = RECENT_DIARY_LIMIT): Promise<string[]> {
  const pages = await db.pages.orderBy('createdAt').reverse().limit(limit).toArray();
  return pages.map((p) => p.diary).filter((d): d is string => Boolean(d));
}

/**
 * 对话请求前调用：加载画像（无则空画像）+ 最近日记 → 自然语言注入段落。
 * 返回注入文本；同时给出 profile 与 recentDiaries，便于调用方传给 ai.chat()。
 */
export async function buildChatInjection(
  limit: number = RECENT_DIARY_LIMIT,
): Promise<{ injection: string; profile: Profile; recentDiaries: string[] }> {
  const store = useProfileStore.getState();
  const profile = store.profile ?? (await store.load());
  const recentDiaries = await getRecentDiarySnippets(limit);
  return { injection: renderMemory(profile, recentDiaries), profile, recentDiaries };
}
