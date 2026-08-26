// Dexie schema —— 对应 development.md §5.3 的五张表
import Dexie, { type EntityTable } from 'dexie';

/** 待处理草稿：照片 + 上下文（主流程断点全量落盘，§3.2 兜底） */
export interface Draft {
  id: string;
  photoBlob: Blob;
  capturedAt: number;
  /** 处理阶段：待转换 / 转换完成待引导 / 引导完成待生成 */
  stage: 'captured' | 'converted' | 'chatted';
  /** 立绘管线产物（转换后回填） */
  cutoutConfig?: Record<string, unknown>;
  /** 立绘图层 Blob（转换后回填；收进书时写入 BookPage.layers） */
  layers?: {
    foreground?: Blob;
    midground?: Blob;
    backdrop?: Blob;
    background?: Blob;
    base?: Blob;
    shadow?: Blob;
  };
  /** 照片解读（story 首次开场前获取并落盘，重进不重复调用） */
  interpretation?: Record<string, unknown>;
  /** 已生成的日记正文（entry 页生成后落盘，断点不丢） */
  diaryText?: string;
}

/** 一条对话消息 */
export interface ChatMessage {
  role: 'ai' | 'user';
  text: string;
  at: number;
}

/** 引导对话记录（可续聊） */
export interface Conversation {
  id: string;
  draftId: string;
  messages: ChatMessage[];
  status: 'active' | 'finished';
  updatedAt: number;
}

/** 书页：立绘配置 + 图层 Blob + 日记 */
export interface BookPage {
  id: string;
  /** 所属月份，如 '2026-08' */
  month: string;
  createdAt: number;
  /** 立绘配置 JSON（图层变换/视差参数） */
  config: Record<string, unknown>;
  /** 图层图片：前/中/远元素层 + 背景虚化 + 纸页底 + 前景投影 */
  layers: {
    foreground?: Blob;
    midground?: Blob;
    backdrop?: Blob;
    background?: Blob;
    base?: Blob;
    shadow?: Blob;
  };
  /** 日记正文（第二人称回望式，150~400 字） */
  diary: string;
  /** 照片解读（冗余存一份，便于导出与排查） */
  interpretation?: Record<string, unknown>;
}

/** 用户画像（结构化，详见 §8.2 与 features/memory） */
export interface ProfileRecord {
  /** 固定为 'me'，单用户单画像 */
  id: string;
  data: unknown;
  updatedAt: string;
}

/** 设置：设备 token、偏好 */
export interface SettingRecord {
  key: string;
  value: unknown;
}

export const db = new Dexie('huiyi') as Dexie & {
  drafts: EntityTable<Draft, 'id'>;
  conversations: EntityTable<Conversation, 'id'>;
  pages: EntityTable<BookPage, 'id'>;
  profile: EntityTable<ProfileRecord, 'id'>;
  settings: EntityTable<SettingRecord, 'key'>;
};

db.version(1).stores({
  drafts: 'id, capturedAt, stage',
  conversations: 'id, draftId, status, updatedAt',
  pages: 'id, month, createdAt',
  profile: 'id',
  settings: 'key',
});
