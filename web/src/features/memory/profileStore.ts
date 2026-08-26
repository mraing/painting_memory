// 画像 store（zustand）—— 读写 db.profile。
// 合并走确定性算法 mergeProfile（merge.ts，§8.4）；注入渲染见 render.ts / inject.ts。

import { create } from 'zustand';
import { db, type ProfileRecord } from '../../db/db';
import { createEmptyProfile, type Profile, type ProfileCandidate } from './types';
import { mergeProfile } from './merge';
import { extractProfileCandidates, type ExtractInput } from './extractor';

const PROFILE_ID = 'me';

interface ProfileState {
  profile: Profile | null;
  loaded: boolean;
  /** 从 IndexedDB 载入画像（无则新建空画像） */
  load(): Promise<Profile>;
  /** 整体替换并持久化 */
  save(profile: Profile): Promise<void>;
  /** 合并候选画像更新（§8.4 确定性合并），返回合并后的画像 */
  merge(candidates: ProfileCandidate[]): Promise<Profile>;
  /**
   * 日记生成后调用（§8.4 接入点）：从引导对话提取候选画像更新并合并入库。
   * 模拟「日记生成同一次调用顺带输出画像候选」——真后端由 diary 响应携带 candidates，
   * 前端只调 merge；Mock 期在这里补齐提取步骤。
   */
  applyDiaryExtraction(conversation: ExtractInput[], date?: string): Promise<Profile>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  loaded: false,

  async load() {
    const row = await db.profile.get(PROFILE_ID);
    if (row) {
      const profile = row.data as Profile;
      set({ profile, loaded: true });
      return profile;
    }
    const fresh = createEmptyProfile();
    const record: ProfileRecord = { id: PROFILE_ID, data: fresh, updatedAt: fresh.updatedAt };
    await db.profile.put(record);
    set({ profile: fresh, loaded: true });
    return fresh;
  },

  async save(profile) {
    profile.updatedAt = new Date().toISOString();
    await db.profile.put({ id: PROFILE_ID, data: profile, updatedAt: profile.updatedAt });
    set({ profile });
  },

  async merge(candidates) {
    const current = get().profile ?? (await get().load());
    // 深拷贝后合并，避免原地改动污染 store 里正在被渲染引用的对象
    const next = mergeProfile(structuredClone(current), candidates);
    await get().save(next);
    return next;
  },

  async applyDiaryExtraction(conversation, date) {
    const candidates = extractProfileCandidates(conversation, date);
    if (candidates.length === 0) return get().profile ?? (await get().load());
    return get().merge(candidates);
  },
}));
