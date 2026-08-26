// Mock AI 适配器 —— 顶替后端 /api/understand /api/chat /api/diary。
// 接口形状与未来后端 DTO 对齐，见 docs/api-contract.md。
// 所有方法统一 600~1200ms 模拟延迟，断网兜底由调用方处理。

import type { Profile, ProfileCandidate } from '../memory/types';
import { renderProfileForPrompt } from '../memory/render';
import { extractProfileCandidates } from '../memory/extractor';

/** 结构化照片解读 */
export interface PhotoInterpretation {
  /** 主体（如「一只橘猫」） */
  subject: string;
  /** 背景描述 */
  background: string;
  /** 前景描述 */
  foreground: string;
  /** 氛围（如「午后慵懒」） */
  mood: string;
  /** 画面里的可辨识元素 */
  elements: string[];
}

export interface ChatTurn {
  role: 'ai' | 'user';
  text: string;
}

export interface DiaryResult {
  /** 150~400 字，第二人称回望式 */
  text: string;
  /** 同一次调用顺带产出的候选画像更新（§8.4 零成本技巧；Mock 期由关键词规则提取器产出） */
  profileCandidates: ProfileCandidate[];
}

export interface AiAdapter {
  understand(photoBlob: Blob): Promise<PhotoInterpretation>;
  chat(history: ChatTurn[], profile: Profile | null, recentDiaries: string[]): Promise<string>;
  diary(conversation: ChatTurn[], interpretation: PhotoInterpretation): Promise<DiaryResult>;
}

const delay = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 600 + Math.random() * 600));

// —— 问题池：确认式开场（基于解读）+ 通用追问 ————————————
const OPENERS: ((it: PhotoInterpretation) => string)[] = [
  (it) => `画面里${it.subject}，是你很熟悉的伙伴吧？`,
  (it) => `${it.mood}的感觉扑面而来——那天是什么让你举起了手机？`,
  (it) => `我注意到${it.elements[0] ?? it.foreground}，它对你有什么特别的吗？`,
];

const FOLLOW_UPS = [
  '那一刻你心里最先冒出来的是什么？',
  '如果把这一天折成一个小物件收进口袋，你会选什么？',
  '这个画面让你想起以前的哪个瞬间吗？',
  '还有什么是照片装不下、但你想要记住的？',
];

const CLOSERS = [
  '嗯，我都记下了。要我把今天写成一页吗？',
  '谢谢你愿意讲这些。剩下的，交给笔和纸吧。',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function createMockAiAdapter(): AiAdapter {
  let lastInterpretation: PhotoInterpretation | null = null;

  return {
    async understand(photoBlob: Blob): Promise<PhotoInterpretation> {
      // Mock 阶段不真正读图；保留参数以对齐未来后端（接收 512px 压缩图）
      void photoBlob;
      await delay();
      lastInterpretation = {
        subject: '一只趴在窗台上的小家伙',
        background: '午后的光落在旧木窗台上，远处有晾着的白衬衫',
        foreground: '一小团毛茸茸的影子，尾巴垂在窗边',
        mood: '慵懒而安稳',
        elements: ['窗台', '白衬衫', '一盆绿萝', '斜斜的光'],
      };
      return lastInterpretation;
    },

    async chat(
      history: ChatTurn[],
      profile: Profile | null,
      recentDiaries: string[],
    ): Promise<string> {
      await delay();
      // 画像/近期日记注入点：真实实现里由服务端拼进 prompt。
      // Mock 期渲染一遍以确保接口被真实调用。
      void renderProfileForPrompt(profile, recentDiaries);

      const userTurns = history.filter((m) => m.role === 'user').length;
      if (history.length === 0) {
        const it = lastInterpretation ?? {
          subject: '画面里的主角',
          mood: '安安静静',
          foreground: '',
          elements: [],
          background: '',
        };
        return pick(OPENERS)(it);
      }
      if (userTurns >= 3) return pick(CLOSERS);

      // 简单上下文感知：用户提到「猫/狗」则顺着问，否则从问题池抽
      const lastUser = [...history].reverse().find((m) => m.role === 'user')?.text ?? '';
      if (/猫/.test(lastUser)) return '那只猫平时也是这样安安静静的吗，还是只有午后才这样？';
      if (/狗/.test(lastUser)) return '那只狗那天是不是又在门口等你了？';
      if (/妈|外婆|家人/.test(lastUser)) return '听你提起家人——这个画面里也有他们的影子吗？';
      return pick(FOLLOW_UPS);
    },

    async diary(
      conversation: ChatTurn[],
      interpretation: PhotoInterpretation,
    ): Promise<DiaryResult> {
      await delay();
      // 模板拼装：照片元素 + 用户只言片语 → 第二人称回望式
      const userBits = conversation
        .filter((m) => m.role === 'user')
        .map((m) => m.text.replace(/[。\.\!\!？?]+$/, ''))
        .slice(0, 3);

      const parts: string[] = [];
      parts.push(
        `那天，${interpretation.background}。${interpretation.foreground}，整个画面透着${interpretation.mood}的气息。`,
      );
      if (userBits.length > 0) {
        parts.push(`你说，${userBits[0]}。这句话轻轻落在画面上，像一枚书签。`);
      }
      if (userBits.length > 1) {
        parts.push(`后来你又提起，${userBits[1]}——原来这一天在你心里叠了不止一层。`);
      }
      if (userBits.length > 2) {
        parts.push(`你还说，${userBits[2]}。`);
      }
      parts.push(
        `${interpretation.elements.slice(0, 3).join('、')}，都被你一并收进了这一天。回头再看，大概会感谢当时举起手机的自己吧。`,
      );

      let text = parts.join('');
      // 约束在 150~400 字
      while (text.length < 150) {
        text += '那天的光很慢，慢到足够你把这一刻看了又看。';
      }
      if (text.length > 400) text = text.slice(0, 397) + '……';

      // 模拟 §8.4「日记 + 候选画像更新」同一次调用双输出：
      // 真后端由 LLM 按 §8.3 五问判定提取；Mock 期用关键词/规则启发式顶替，
      // 输出形状与后端 DTO（docs/api-contract.md POST /api/diary）一致。
      const today = new Date().toISOString().slice(0, 10);
      return { text, profileCandidates: extractProfileCandidates(conversation, today) };
    },
  };
}

/** 全局 Mock 实例；接后端后替换为 HTTP 客户端实现即可 */
export const ai = createMockAiAdapter();
