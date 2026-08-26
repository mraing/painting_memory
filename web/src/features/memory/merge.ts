// 确定性合并算法 —— development.md §8.4：不用 LLM，代码写死。
// 规则：同实体（name/topic 归一化匹配）→ count+1、lastSeen 更新、traits 并集；
//       冲突描述 → 保留 count 更高者，低者降级为 notes 备注；
//       膨胀上限 200 项 → 按 count/recency 裁剪。
//
// 边界决策（向 captain 汇报过）：
// - 冲突时「count 更高者」= 既有实体（候选是单次观察，count 恒为 1；合并后既有实体
//   count 为 N+1）→ 保留既有字段值，本条候选的冲突值降级进 notes（notes 存原始值，
//   render 时以「另有说法」渲染，信息不丢失，LLM 仍可见）。
// - traits 无 count 字段，§8.4「按 count 排序」解释为实体列表排序；traits 保持稳定插入序。
// - importantDate/habit 无 count，冲突按「并存拼接」处理，拼接上限 MAX_NOTE_LEN。

import {
  normalizeKey,
  type Profile,
  type ProfileCandidate,
  type ProfilePerson,
  type ProfilePlace,
  type ProfilePreference,
  type ProfileImportantDate,
  type ProfileHabit,
} from './types';

/** 各列表膨胀上限（§8.4「如 200 项」按列表实施） */
export const PROFILE_LIST_CAP = 200;
/** 单实体 traits 并集上限（防单实体无限膨胀） */
export const TRAITS_CAP = 20;
/** 单实体冲突备注上限 */
export const NOTES_CAP = 5;
/** 拼接型字段（importantDate/habit 的 note）单条长度上限 */
export const MAX_NOTE_LEN = 120;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** traits 并集：按入序去重追加，超长截断 */
function unionTraits(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map(normalizeKey));
  const out = [...existing];
  for (const t of incoming) {
    const k = normalizeKey(t);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out.slice(0, TRAITS_CAP);
}

function pushNote(notes: string[] | undefined, note: string | undefined): string[] | undefined {
  if (!note) return notes;
  const out = [...(notes ?? [])];
  if (!out.map(normalizeKey).includes(normalizeKey(note))) out.push(note);
  return out.slice(-NOTES_CAP);
}

/** 稳定裁剪：count 降序 → recency（lastSeen）降序；无 lastSeen 的按 epoch 0 */
function trimByCountAndRecency<T extends { count: number; lastSeen?: string }>(
  list: T[],
  cap: number,
): T[] {
  if (list.length <= cap) return list;
  return [...list]
    .sort((a, b) => b.count - a.count || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
    .slice(0, cap);
}

function mergePerson(list: ProfilePerson[], c: Extract<ProfileCandidate, { kind: 'person' }>) {
  const key = normalizeKey(c.name);
  const found = list.find((p) => normalizeKey(p.name) === key);
  const date = c.date ?? today();
  if (!found) {
    list.push({
      name: c.name,
      relation: c.relation,
      traits: c.trait ? [c.trait] : [],
      count: 1,
      lastSeen: date,
    });
    return;
  }
  found.count += 1;
  found.lastSeen = date;
  found.traits = unionTraits(found.traits, c.trait ? [c.trait] : []);
  if (c.relation && c.relation !== found.relation) {
    // 关系冲突（§8.4）：保留 count 更高者（既有），低者（候选）降级为备注
    found.notes = pushNote(found.notes, c.relation);
  }
}

function mergePlace(list: ProfilePlace[], c: Extract<ProfileCandidate, { kind: 'place' }>) {
  const key = normalizeKey(c.name);
  const found = list.find((p) => normalizeKey(p.name) === key);
  const date = c.date ?? today();
  if (!found) {
    list.push({ name: c.name, meaning: c.meaning, count: 1, lastSeen: date });
    return;
  }
  found.count += 1;
  found.lastSeen = date;
  if (c.meaning && normalizeKey(c.meaning) !== normalizeKey(found.meaning ?? '')) {
    // 意义冲突：保留既有 meaning，候选降级为备注
    found.notes = pushNote(found.notes, c.meaning);
  }
}

function mergePreference(
  list: ProfilePreference[],
  c: Extract<ProfileCandidate, { kind: 'preference' }>,
) {
  const key = normalizeKey(c.topic);
  const found = list.find((p) => normalizeKey(p.topic) === key);
  if (!found) {
    list.push({ topic: c.topic, note: c.note, count: 1 });
    return;
  }
  found.count += 1;
  if (c.note && normalizeKey(c.note) !== normalizeKey(found.note)) {
    // 描述冲突：保留既有 note，候选降级为备注
    found.notes = pushNote(found.notes, c.note);
  }
}

function mergeImportantDate(
  list: ProfileImportantDate[],
  c: Extract<ProfileCandidate, { kind: 'importantDate' }>,
) {
  const found = list.find((d) => d.date === c.date);
  if (!found) {
    list.push({ date: c.date, note: c.note });
    return;
  }
  if (c.note && normalizeKey(c.note) !== normalizeKey(found.note)) {
    // 同日不同注：并存拼接（日期是硬事实，无 count 可比）
    const merged = `${found.note}；${c.note}`;
    found.note =
      merged.length > MAX_NOTE_LEN ? `${merged.slice(0, MAX_NOTE_LEN - 1)}…` : merged;
  }
}

function mergeHabit(list: ProfileHabit[], c: Extract<ProfileCandidate, { kind: 'habit' }>) {
  const key = normalizeKey(c.topic);
  const found = list.find((h) => normalizeKey(h.topic) === key);
  if (!found) {
    list.push({ topic: c.topic, note: c.note });
    return;
  }
  if (c.note && normalizeKey(c.note) !== normalizeKey(found.note)) {
    const merged = `${found.note}；${c.note}`;
    found.note =
      merged.length > MAX_NOTE_LEN ? `${merged.slice(0, MAX_NOTE_LEN - 1)}…` : merged;
  }
}

/**
 * 把候选画像更新合并进 existing（原地修改并返回同一对象，便于测试）；
 * candidates 顺序应用，同批内自相撞也按同一套规则归并。
 */
export function mergeProfile(existing: Profile, candidates: ProfileCandidate[]): Profile {
  for (const c of candidates) {
    switch (c.kind) {
      case 'person':
        mergePerson(existing.people, c);
        break;
      case 'place':
        mergePlace(existing.places, c);
        break;
      case 'preference':
        mergePreference(existing.preferences, c);
        break;
      case 'importantDate':
        mergeImportantDate(existing.importantDates, c);
        break;
      case 'habit':
        mergeHabit(existing.habits, c);
        break;
    }
  }
  existing.people = trimByCountAndRecency(existing.people, PROFILE_LIST_CAP);
  existing.places = trimByCountAndRecency(existing.places, PROFILE_LIST_CAP);
  // preferences 无 lastSeen，仅按 count 裁剪
  if (existing.preferences.length > PROFILE_LIST_CAP) {
    existing.preferences = [...existing.preferences]
      .sort((a, b) => b.count - a.count)
      .slice(0, PROFILE_LIST_CAP);
  }
  existing.updatedAt = new Date().toISOString();
  return existing;
}
