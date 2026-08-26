// 翻页跟手与松手判定的纯逻辑（与渲染解耦，便于单测）。
// 约定：progress ∈ [0,1]，0 = 页未翻动，1 = 页翻完；
// velocity = dp/dt（页/秒），>0 表示朝「翻完」方向加速。

/** 位移过半 → 判定翻完 */
export const FLIP_DECIDE_THRESHOLD = 0.5;
/** 松手速度阈值（页/秒）：位移未过半但甩得够快 → 判定翻完 */
export const FLIP_VELOCITY_THRESHOLD = 0.45;

export type FlipDecision = 'complete' | 'snap-back';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 松手判定（development.md §4.3：按速度/位移判定回弹或翻完）。
 * @param progress 当前翻页进度 0..1
 * @param velocity 松手瞬间的进度速度（页/秒，正 = 朝翻完方向）
 */
export function decideFlipEnd(progress: number, velocity: number): FlipDecision {
  const p = clamp01(progress);
  if (p >= FLIP_DECIDE_THRESHOLD) return 'complete';
  if (velocity >= FLIP_VELOCITY_THRESHOLD) return 'complete';
  return 'snap-back';
}

/**
 * 手指世界坐标 x → 翻页进度。
 * dir=1 前翻（手指从右页向左拖）：页中心(x=W/2)处为 0，脊柱(x=0)处为 0.5，左页中心为 1；
 * dir=-1 后翻（手指从左页向右拖）：镜像映射。
 * @param pageWidth 单页宽度（世界单位）
 */
export function mapPointerToProgress(dir: 1 | -1, x: number, pageWidth: number): number {
  return clamp01(dir === 1 ? 0.5 - x / pageWidth : 0.5 + x / pageWidth);
}

/** 指数缓动一步：current → target，速率 speed（约 12 时 ~150ms 内收敛） */
export function easeToward(current: number, target: number, dt: number, speed = 12): number {
  const k = Math.min(1, dt * speed);
  return current + (target - current) * k;
}

/** 松手后动画是否已收敛（|diff| 小于阈值即认为到位） */
export function isSettled(current: number, target: number, eps = 0.002): boolean {
  return Math.abs(current - target) <= eps;
}

/* ---------------- 松手速度（t9：短窗口平均，降低高频 pointermove 噪声） ---------------- */

export interface VelocitySample {
  /** 手指世界坐标 x */
  x: number;
  /** 事件时间戳（ms，DOMHighResTimeStamp） */
  t: number;
}

/**
 * 用采样窗口的端点斜率估松手速度（页/秒，正 = 朝翻完方向）。
 * 相比「最后一段采样」：窗口覆盖 3~4 个 pointermove（≈50ms@60Hz），
 * 平均掉 1~2px 抖动噪声，同时保留甩动手势的响应性。
 * @param samples 时间升序的采样（≥2 才有速度）
 */
export function windowedVelocity(
  samples: VelocitySample[],
  dir: 1 | -1,
  pageWidth: number,
): number {
  if (samples.length < 2 || pageWidth <= 0) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dtSec = (last.t - first.t) / 1000;
  if (dtSec <= 0) return 0;
  const dx = last.x - first.x;
  const v = (dx / dtSec) / pageWidth; // dp/dx = -dir/W
  return dir === 1 ? -v : v;
}

/* ---------------- 按压意图（t10：端点死区修复的纯逻辑，供 BookViewer 使用） ---------------- */

/**
 * 该按压方向在当前位置是否可真的翻页（边界守卫）。
 * 末页右半（dir=1）与首页左半（dir=-1）不可翻页——但 tap/long-press 仍应生效。
 */
export function canFlipDirection(dir: 1 | -1, current: number, pageCount: number): boolean {
  if (dir === 1) return current < pageCount - 1;
  return current > 0;
}

/**
 * 按压落点对应的页索引：右半页 = current，左半页 = current - 1；
 * 端点（首页左半）夹取回 current，保证 tap/long-press 总有合法目标页。
 */
export function pageUnderPress(dir: 1 | -1, current: number): number {
  const idx = dir === 1 ? current : current - 1;
  return idx >= 0 ? idx : current;
}

export interface PressContext {
  dir: 1 | -1;
  /** 当前右页索引 */
  current: number;
  pageCount: number;
  /** 目标页纹理是否已加载（真正翻页需要） */
  texReady: boolean;
}

export interface PressIntent {
  /** 是否可以真的翻页（边界内且纹理就绪）；false 时按压仅服务 tap/long-press */
  canFlip: boolean;
  /** 本次按压对应的页索引（tap/long-press 目标，端点夹取） */
  pageIndex: number;
}

/** 解析一次按压的意图：翻页能力与目标页解耦（t10 死区修复的核心） */
export function resolvePressIntent(ctx: PressContext): PressIntent {
  return {
    canFlip: canFlipDirection(ctx.dir, ctx.current, ctx.pageCount) && ctx.texReady,
    pageIndex: pageUnderPress(ctx.dir, ctx.current),
  };
}
