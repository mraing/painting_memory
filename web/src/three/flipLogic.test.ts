import { describe, expect, it } from 'vitest';
import {
  canFlipDirection,
  clamp01,
  decideFlipEnd,
  easeToward,
  isSettled,
  mapPointerToProgress,
  pageUnderPress,
  resolvePressIntent,
  windowedVelocity,
} from './flipLogic';

describe('decideFlipEnd（松手判定：位移/速度）', () => {
  it('位移过半 → 翻完', () => {
    expect(decideFlipEnd(0.5, 0)).toBe('complete');
    expect(decideFlipEnd(0.62, -1)).toBe('complete');
    expect(decideFlipEnd(1, -99)).toBe('complete');
  });

  it('位移未过半且无速度 → 回弹', () => {
    expect(decideFlipEnd(0, 0)).toBe('snap-back');
    expect(decideFlipEnd(0.49, 0)).toBe('snap-back');
    expect(decideFlipEnd(0.3, 0.2)).toBe('snap-back');
  });

  it('位移未过半但甩动速度足够 → 翻完', () => {
    expect(decideFlipEnd(0.3, 0.45)).toBe('complete');
    expect(decideFlipEnd(0, 1.2)).toBe('complete');
  });

  it('反向甩动 → 回弹', () => {
    expect(decideFlipEnd(0.2, -0.8)).toBe('snap-back');
  });

  it('进度越界被钳制', () => {
    expect(decideFlipEnd(-0.2, 0)).toBe('snap-back');
    expect(decideFlipEnd(1.4, 0)).toBe('complete');
  });
});

describe('mapPointerToProgress（跟手映射）', () => {
  const W = 300;

  it('前翻：右页中心=0、脊柱=0.5、左页中心=1', () => {
    expect(mapPointerToProgress(1, W / 2, W)).toBe(0);
    expect(mapPointerToProgress(1, 0, W)).toBe(0.5);
    expect(mapPointerToProgress(1, -W / 2, W)).toBe(1);
  });

  it('后翻：左页中心=0、脊柱=0.5、右页中心=1', () => {
    expect(mapPointerToProgress(-1, -W / 2, W)).toBe(0);
    expect(mapPointerToProgress(-1, 0, W)).toBe(0.5);
    expect(mapPointerToProgress(-1, W / 2, W)).toBe(1);
  });

  it('超出书沿被钳制到 0/1', () => {
    expect(mapPointerToProgress(1, W, W)).toBe(0);
    expect(mapPointerToProgress(1, -W, W)).toBe(1);
  });
});

describe('easeToward / isSettled（回弹与翻完动画收敛）', () => {
  it('单调趋近目标且最终收敛', () => {
    let p = 0.05;
    for (let i = 0; i < 200 && !isSettled(p, 1); i++) {
      const next = easeToward(p, 1, 1 / 60);
      expect(next).toBeGreaterThan(p);
      expect(next).toBeLessThanOrEqual(1);
      p = next;
    }
    expect(isSettled(p, 1)).toBe(true);
  });

  it('大 dt 不越界（k 被钳制）', () => {
    expect(easeToward(0.2, 1, 10)).toBe(1);
    expect(easeToward(0.9, 0, 10)).toBe(0);
  });

  it('clamp01', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });
});

describe('按压意图（t10 回归：端点死区 tap/long-press 生效）', () => {
  const N = 6; // 共 6 页

  it('末页右半页（首屏落点）：不可翻页，但 tap/long-press 目标=当前页（不再被方向守卫误挡）', () => {
    const intent = resolvePressIntent({ dir: 1, current: N - 1, pageCount: N, texReady: true });
    expect(intent.canFlip).toBe(false); // 不能翻出书外
    expect(intent.pageIndex).toBe(N - 1); // 点按/长按目标是当前页，可打开/删除
  });

  it('首页左半页：不可翻页，但 tap/long-press 目标夹取回首页', () => {
    const intent = resolvePressIntent({ dir: -1, current: 0, pageCount: N, texReady: true });
    expect(intent.canFlip).toBe(false);
    expect(intent.pageIndex).toBe(0);
  });

  it('末页右半页且纹理未就绪：tap/long-press 依然生效（tap 不依赖纹理）', () => {
    const intent = resolvePressIntent({ dir: 1, current: N - 1, pageCount: N, texReady: false });
    expect(intent.canFlip).toBe(false);
    expect(intent.pageIndex).toBe(N - 1);
  });

  it('中间页：右半可前翻、左半可后翻，目标页正确', () => {
    expect(resolvePressIntent({ dir: 1, current: 3, pageCount: N, texReady: true })).toEqual({
      canFlip: true,
      pageIndex: 3,
    });
    expect(resolvePressIntent({ dir: -1, current: 3, pageCount: N, texReady: true })).toEqual({
      canFlip: true,
      pageIndex: 2,
    });
  });

  it('中间页纹理未就绪：不能翻页，但 tap 目标仍在', () => {
    const intent = resolvePressIntent({ dir: 1, current: 3, pageCount: N, texReady: false });
    expect(intent.canFlip).toBe(false);
    expect(intent.pageIndex).toBe(3);
  });

  it('canFlipDirection / pageUnderPress 基础断言', () => {
    expect(canFlipDirection(1, N - 1, N)).toBe(false);
    expect(canFlipDirection(1, N - 2, N)).toBe(true);
    expect(canFlipDirection(-1, 0, N)).toBe(false);
    expect(canFlipDirection(-1, 1, N)).toBe(true);
    expect(pageUnderPress(1, 5)).toBe(5);
    expect(pageUnderPress(-1, 5)).toBe(4);
    expect(pageUnderPress(-1, 0)).toBe(0); // 端点夹取
  });
});

describe('windowedVelocity（t9：松手速度短窗口平均，降 pointermove 噪声）', () => {
  const W = 300;

  it('少于 2 个采样 → 0', () => {
    expect(windowedVelocity([], 1, W)).toBe(0);
    expect(windowedVelocity([{ x: 10, t: 0 }], 1, W)).toBe(0);
  });

  it('前翻（dir=1）：手指向左移动 → 速度为正向（朝翻完）', () => {
    const samples = [
      { x: 150, t: 0 },
      { x: 120, t: 16 },
      { x: 90, t: 32 },
      { x: 60, t: 48 },
    ];
    const v = windowedVelocity(samples, 1, W);
    expect(v).toBeCloseTo((90 / 0.048) / W, 6); // dx=-90px / 48ms / 页宽
    expect(v).toBeGreaterThan(0);
  });

  it('后翻（dir=-1）：手指向右移动 → 速度为正', () => {
    const samples = [
      { x: -150, t: 0 },
      { x: -120, t: 16 },
      { x: -90, t: 32 },
      { x: -60, t: 48 },
    ];
    expect(windowedVelocity(samples, -1, W)).toBeGreaterThan(0);
  });

  it('方向与移动相反 → 速度为负（朝回弹方向）', () => {
    const samples = [
      { x: 100, t: 0 },
      { x: 140, t: 32 },
    ];
    expect(windowedVelocity(samples, 1, W)).toBeLessThan(0);
  });

  it('窗口只取最近采样（抖动平均）：中间噪声不影响端点斜率', () => {
    const samples = [
      { x: 100, t: 0 },
      { x: 99, t: 16 },
      { x: 60, t: 32 },
      { x: 61, t: 48 },
      { x: 20, t: 64 },
    ];
    // 端点斜率 = (20-100)/(0.064s) → 负斜率 → 前翻为正向
    const v = windowedVelocity(samples, 1, W);
    expect(v).toBeCloseTo((80 / 0.064) / W, 6);
    expect(v).toBeGreaterThan(0);
  });

  it('零时间跨度 → 0（避免除零）', () => {
    const samples = [
      { x: 10, t: 100 },
      { x: 20, t: 100 },
    ];
    expect(windowedVelocity(samples, 1, W)).toBe(0);
  });

  it('页宽 ≤0 → 0', () => {
    const samples = [
      { x: 10, t: 0 },
      { x: 20, t: 100 },
    ];
    expect(windowedVelocity(samples, 1, 0)).toBe(0);
  });
});
