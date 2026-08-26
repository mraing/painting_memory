// 书浏览数据模型（features/book）—— pages 表 → 浏览层/单页 3D 层所需形状。
// 浏览层（§6.2 第一层）：BookViewer 消费 BookPage3D（id/month/image）；
// 单页 3D 层（§6.2 第二层）：PageDetailView 消费 layers + diary。

import type { BookPage3D } from '../../three/BookViewer';
import type { IllustrationLayers } from '../../three/IllustrationScene';
import type { TextureSource } from '../../three/textures';

/** 书页条目：浏览层页图 + 单页 3D 图层 + 日记（由 pages 表映射，或 mock 兜底） */
export interface BookPageItem {
  id: string;
  /** 所属月份 'YYYY-MM'（分章依据） */
  month: string;
  /** 预渲染页图（§6.2 浏览层）；无页图时为 null（BookViewer 显示空白纸） */
  image: TextureSource | null;
  /** 日记正文（150~400 字，第二人称回望式；单页 3D 场景下半部展示） */
  diary: string;
  /** 立绘图层（单页完整 3D 场景；可缺省，缺省时仅展示页图） */
  layers: IllustrationLayers;
}

/** 单页完整 3D 场景所需数据（与浏览条目同形，另加可选解读备注） */
export interface BookPageDetail extends BookPageItem {
  /** 照片解读（冗余，展示用） */
  interpretation?: Record<string, unknown> | null;
}

/** 月份章节（§2 决策 8：一本总书、按月分章） */
export interface BookChapter {
  month: string;
  /** 章首页下标（pages 顺序） */
  index: number;
  /** 本章页数 */
  count: number;
}

export type { BookPage3D };
