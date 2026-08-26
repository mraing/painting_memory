// 注入渲染 —— development.md §8.4：画像渲染成自然语言段落（比 JSON 省 token、
// 表达力强），如「关于 TA 的记忆：妈妈（做菜很好吃，拿手菜是红烧肉；最近 3 次提到）……」，
// 再拼最近 3~5 篇日记截断，随对话请求发给模型。

import type { Profile } from './types';

/** 注入的最近日记篇数（§8.1 L1：最近 3~5 篇） */
export const RECENT_DIARY_LIMIT = 5;
/** 单篇日记注入截断长度（§8.1 L1：每篇截断 300 字） */
export const DIARY_SNIPPET_LEN = 300;

/** 单个人物/地点/偏好的自然语言短句 */
function renderPerson(p: Profile['people'][number]): string {
  const parts: string[] = [];
  if (p.relation) parts.push(p.relation);
  if (p.traits.length > 0) parts.push(p.traits.slice(0, 3).join('，'));
  parts.push(`最近 ${p.count} 次提到`);
  if (p.notes?.length) parts.push(`另有说法：${p.notes.join('；')}`);
  return `${p.name}（${parts.join('；')}）`;
}

function renderPlace(p: Profile['places'][number]): string {
  const parts: string[] = [];
  if (p.meaning) parts.push(p.meaning);
  parts.push(`最近 ${p.count} 次提到`);
  if (p.notes?.length) parts.push(`另有说法：${p.notes.join('；')}`);
  return `${p.name}（${parts.join('；')}）`;
}

function renderPreference(p: Profile['preferences'][number]): string {
  const extras: string[] = [];
  if (p.count > 1) extras.push(`${p.count} 次提到`);
  if (p.notes?.length) extras.push(`另有说法：${p.notes.join('；')}`);
  return `${p.topic}：${p.note}${extras.length > 0 ? `（${extras.join('；')}）` : ''}`;
}

/**
 * 把画像 + 近期日记渲染成注入 prompt 的自然语言段落。
 * 没有任何记忆时返回空字符串。
 */
export function renderMemory(profile: Profile | null, recentDiaries: string[]): string {
  const sections: string[] = [];

  if (profile) {
    const bits: string[] = [];
    for (const p of profile.people) bits.push(renderPerson(p));
    for (const p of profile.places) bits.push(renderPlace(p));
    for (const p of profile.preferences) bits.push(renderPreference(p));
    for (const d of profile.importantDates) bits.push(`${d.date}：${d.note}`);
    for (const h of profile.habits) bits.push(`${h.topic}：${h.note}`);
    if (bits.length > 0) {
      sections.push(`关于 TA 的记忆：${bits.join('；')}。`);
    }
  }

  if (recentDiaries.length > 0) {
    const snippets = recentDiaries
      .slice(0, RECENT_DIARY_LIMIT)
      .map((d) => (d.length > DIARY_SNIPPET_LEN ? `${d.slice(0, DIARY_SNIPPET_LEN)}……` : d));
    sections.push(`最近的日记：${snippets.map((s) => `「${s}」`).join('，')}`);
  }

  return sections.join('\n');
}

/** 兼容旧名（T1 占位时导出过） */
export const renderProfileForPrompt = renderMemory;
