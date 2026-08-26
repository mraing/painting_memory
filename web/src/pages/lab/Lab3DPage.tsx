// /lab/3d 演示页：用 mock 数据并排展示立绘预览与 3D 书，便于联调。
// 提供：WebGL 能力徽标、FPS 计、强制降级开关（验证 §6.3 兜底渲染）。

import { useEffect, useMemo, useState } from 'react';
import { useCapabilities } from '../../three/capabilities';
import { IllustrationScene } from '../../three/IllustrationScene';
import { BookViewer, type BookPage3D } from '../../three/BookViewer';
import type { IllustrationLayers } from '../../three/IllustrationScene';
import { makeMockLayers, makeMockPages } from '../../three/demo/mockAssets';

function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      frames++;
      if (t - last >= 1000) {
        setFps(Math.round((frames * 1000) / (t - last)));
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

export default function Lab3DPage() {
  const caps = useCapabilities();
  const fps = useFps();
  const [layers, setLayers] = useState<IllustrationLayers | null>(null);
  const [pages, setPages] = useState<BookPage3D[]>([]);
  const [fallback, setFallback] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [l, p] = await Promise.all([makeMockLayers(), makeMockPages(6)]);
      if (!alive) return;
      setLayers(l);
      setPages(p);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const capabilityLabel = useMemo(() => {
    if (caps.webgl === 'full') return 'WebGL 完整';
    if (caps.webgl === 'software') return 'WebGL 软渲染（自动降级）';
    return 'WebGL 不可用（降级渲染）';
  }, [caps.webgl]);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '1rem 1.25rem 3rem' }}>
      <h1 style={{ fontWeight: 400, letterSpacing: '0.1em', fontSize: 22 }}>3D 实验室</h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 13, lineHeight: 1.8 }}>
        立绘交互预览 + 3D 书（跟手翻页）。真机上拖动页面即可翻页；松手按速度/位移判定回弹或翻完。
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0 20px', fontSize: 12, color: 'var(--ink-soft)' }}>
        <span style={badge}>{capabilityLabel}</span>
        <span style={badge}>FPS {fps}</span>
        <span style={badge}>{caps.reducedMotion ? '减弱动效' : '动效正常'}</span>
        <label style={{ ...badge, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={fallback}
            onChange={(e) => setFallback(e.target.checked)}
          />
          强制降级（静态版）
        </label>
      </div>

      <h2 style={sectionTitle}>一 · 立绘交互预览</h2>
      <div
        style={{
          background: 'rgba(58,54,48,0.05)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 28,
        }}
      >
        {layers ? (
          <IllustrationScene
            layers={layers}
            forceFallback={fallback}
            style={{ height: '62vh', minHeight: 380 }}
          />
        ) : (
          <div style={{ height: '62vh', minHeight: 380, display: 'grid', placeItems: 'center', color: 'var(--ink-soft)' }}>
            正在生成 mock 立绘图层…
          </div>
        )}
        <p style={{ color: 'var(--ink-soft)', fontSize: 12, margin: '8px 0 0' }}>
          指针倾斜视差 + 呼吸浮动 + 纸缘厚度（深色副本露边）。渲染层为背景/前景剪纸分层平面。
        </p>
      </div>

      <h2 style={sectionTitle}>二 · 3D 书（按月分章 · 开书落最新页）</h2>
      <div
        style={{
          background: 'rgba(58,54,48,0.05)',
          borderRadius: 8,
          padding: 12,
          marginBottom: 28,
        }}
      >
        {pages.length > 0 ? (
          <BookViewer
            pages={pages}
            cover={{ title: '时光绘本', subtitle: '岁月 · 光影 · 你' }}
            forceFallback={fallback}
            onPageChange={(i) => setPageIdx(i)}
          />
        ) : (
          <div style={{ height: '58vh', minHeight: 360, display: 'grid', placeItems: 'center', color: 'var(--ink-soft)' }}>
            正在生成 mock 书页…
          </div>
        )}
        <p style={{ color: 'var(--ink-soft)', fontSize: 12, margin: '8px 0 0' }}>
          当前第 {pages.length > 0 ? pageIdx + 1 : '-'} 页 / 共 {pages.length || '-'} 页 · 亚麻布纹封面（canvas 程序化）·
          月份页签 · 翻页跟手。点击页签月份即章节位置。
        </p>
      </div>

      <h2 style={sectionTitle}>三 · 说明</h2>
      <ul style={{ color: 'var(--ink-soft)', fontSize: 13, lineHeight: 2, paddingLeft: 18 }}>
        <li>两层渲染策略（§6.2）：浏览 = 预渲染页图 + 轻量视差；点进单页才挂载完整 3D 场景。</li>
        <li>纹理降采样 ≤1024px；翻页窗口外/组件卸载时 dispose 释放。</li>
        <li>翻页选型与成本对比见 <code>docs/book-3d.md</code>。</li>
      </ul>
    </div>
  );
}

const badge: React.CSSProperties = {
  background: 'var(--paper, #f5f1e8)',
  border: '1px solid rgba(58,54,48,0.18)',
  borderRadius: 999,
  padding: '3px 10px',
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 400,
  letterSpacing: '0.12em',
  fontSize: 16,
  margin: '0 0 10px',
};
