// 画像数据模型 —— 对应 development.md §8.2

export interface ProfileUser {
  selfLabel: string;
  /** 怎么称呼用户 */
  naming: string;
}

export interface ProfilePerson {
  name: string;
  relation?: string;
  traits: string[];
  count: number;
  /** ISO 日期 */
  lastSeen?: string;
  /** 冲突降级保留的旧描述（§8.4：冲突保留高 count 者，低者降级为备注） */
  notes?: string[];
}

export interface ProfilePlace {
  name: string;
  meaning?: string;
  count: number;
  lastSeen?: string;
  notes?: string[];
}

export interface ProfilePreference {
  topic: string;
  note: string;
  count: number;
  notes?: string[];
}

export interface ProfileImportantDate {
  /** ISO 日期 */
  date: string;
  note: string;
}

export interface ProfileHabit {
  topic: string;
  note: string;
}

export interface Profile {
  user: ProfileUser;
  people: ProfilePerson[];
  places: ProfilePlace[];
  preferences: ProfilePreference[];
  importantDates: ProfileImportantDate[];
  habits: ProfileHabit[];
  /** ISO 时间戳 */
  updatedAt: string;
}

export function createEmptyProfile(): Profile {
  return {
    user: { selfLabel: '我', naming: '你' },
    people: [],
    places: [],
    preferences: [],
    importantDates: [],
    habits: [],
    updatedAt: new Date().toISOString(),
  };
}

// —— 候选画像更新（日记生成同一次调用顺带输出的形状，§8.4） ————————————

export type ProfileCandidate =
  | { kind: 'person'; name: string; relation?: string; trait?: string; date?: string }
  | { kind: 'place'; name: string; meaning?: string; date?: string }
  | { kind: 'preference'; topic: string; note: string }
  | { kind: 'importantDate'; date: string; note: string }
  | { kind: 'habit'; topic: string; note: string };

/** 实体归一化键：去空白、小写化（避免「妈妈 」与「妈妈」分裂） */
export function normalizeKey(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}
