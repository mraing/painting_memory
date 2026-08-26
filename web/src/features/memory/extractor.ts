// Mock 画像提取器 —— 模拟「日记生成同一次调用顺带输出候选画像更新」（§8.4）。
// 真后端用 LLM + §8.3 五问判定提取；这里用关键词/规则启发式顶替，
// 只产出形状一致的 ProfileCandidate[]，接口与未来后端对齐。
//
// 原则（对齐 §8.3）：只提取可复用的稳定事实（人物关系/地点意义/偏好/重要日期/叙述习惯），
// 一次性事件（「今天下雨」）不进画像。

import type { ProfileCandidate } from './types';

export interface ExtractInput {
  role: 'ai' | 'user';
  text: string;
}

/** 亲属/熟人称谓 → 关系 */
const KINSHIP: [RegExp, string, string][] = [
  [/妈妈|我妈/g, '妈妈', '母亲'],
  [/爸爸|我爸/g, '爸爸', '父亲'],
  [/外婆/g, '外婆', '外婆'],
  [/外公/g, '外公', '外公'],
  [/奶奶/g, '奶奶', '奶奶'],
  [/爷爷/g, '爷爷', '爷爷'],
  [/哥哥/g, '哥哥', '哥哥'],
  [/姐姐/g, '姐姐', '姐姐'],
  [/弟弟/g, '弟弟', '弟弟'],
  [/妹妹/g, '妹妹', '妹妹'],
  [/男朋友/g, '男朋友', '恋人'],
  [/女朋友/g, '女朋友', '恋人'],
];

/** 地点词 → 地名 */
const PLACES: [RegExp, string][] = [
  [/外婆家/g, '外婆家'],
  [/老家/g, '老家'],
  [/公园/g, '公园'],
  [/学校/g, '学校'],
  [/公司/g, '公司'],
  [/海边/g, '海边'],
];

/** 稳定偏好标记（「喜欢/最爱/讨厌 + 名词短语」） */
const PREFERENCE_RE = /(喜欢|最爱|讨厌)([^，。！？!?,]{1,12})/g;
/** 重要日期（M月D日） */
const DATE_RE = /(\d{1,2})月(\d{1,2})日/g;
/** 叙述习惯 */
const HABIT_RE = /先(?:交代|说|写)天气/;

/** 从用户文本里提取某人附近的特质描述（启发式：「很……」「做菜……」「拿手菜是……」） */
function extractTraitNear(text: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${escaped}[^。，]{0,6}?(拿手菜是[^。，]{1,15})`),
    new RegExp(`${escaped}[^。，]{0,6}?(做菜[^。，]{1,15})`),
    new RegExp(`${escaped}(?:人)?(很[^。，]{2,12})`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * 从一段对话里提取候选画像更新。只看用户发言（AI 的话不算事实）。
 * 同一段内同实体可能重复出现——去重交给 mergeProfile（§8.4 归一化匹配）。
 */
export function extractProfileCandidates(conversation: ExtractInput[], date?: string): ProfileCandidate[] {
  const out: ProfileCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: ProfileCandidate) => {
    const key = JSON.stringify(c);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };

  const userTexts = conversation.filter((m) => m.role === 'user').map((m) => m.text);

  for (const text of userTexts) {
    // 人物（亲属称谓）
    for (const [re, name, relation] of KINSHIP) {
      re.lastIndex = 0;
      if (re.test(text)) {
        push({ kind: 'person', name, relation, trait: extractTraitNear(text, name), date });
      }
    }
    // 宠物
    if (/猫/.test(text)) push({ kind: 'person', name: '猫', relation: '宠物', date });
    if (/狗/.test(text)) push({ kind: 'person', name: '狗', relation: '宠物', date });

    // 地点（「童年/小时候/暑假」上下文 → 意义）
    for (const [re, name] of PLACES) {
      re.lastIndex = 0;
      if (re.test(text)) {
        const mMeaning = text.match(/(童年|小时候|暑假|儿时)[^。，]{0,15}/);
        push({ kind: 'place', name, meaning: mMeaning ? mMeaning[0] : undefined, date });
      }
    }

    // 偏好
    PREFERENCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PREFERENCE_RE.exec(text)) !== null) {
      push({ kind: 'preference', topic: m[2], note: `${m[1]}${m[2]}` });
    }

    // 重要日期
    DATE_RE.lastIndex = 0;
    while ((m = DATE_RE.exec(text)) !== null) {
      const year = new Date().getFullYear();
      const iso = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      const ctx = text.slice(Math.max(0, m.index - 8), m.index + m[0].length + 12);
      push({ kind: 'importantDate', date: iso, note: ctx.replace(/^[，。 ]+|[，。 ]+$/g, '') });
    }

    // 叙述习惯
    if (HABIT_RE.test(text)) {
      push({ kind: 'habit', topic: '叙述习惯', note: '讲故事时喜欢先交代天气' });
    }
  }

  return out;
}
