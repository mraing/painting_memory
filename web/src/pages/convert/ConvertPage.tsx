// /convert 立绘转换（§3.1 第 3 步）：调后端立绘服务（server/，Python + OpenCV）→
// 三层剪纸 PNG + 配置；完成后立绘预览（t4 IllustrationScene，WebGL 不可用自动静态降级）；
// 「开始讲故事」入 story。断点兜底：已转换（stage=converted）刷新直接进预览；失败草稿保留可重试（§3.2）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { Button } from '../../components/ui/Button';
import { IllustrationScene, type IllustrationLayers } from '../../three/IllustrationScene';
import { navigateTo } from '../../router';
import { getActiveDraft, patchDraft, useFlowStore } from '../../features/flow';
import { convertPhoto, type CutoutConfig } from '../../features/convert';
import type { Draft } from '../../db/db';
import './ConvertPage.css';

/** 转换进度文案（后端单次调用，展示为阶段轮播） */
const PROGRESS_STEPS = ['正在送照片去剪裁…', '正在找主角…', '正在剪出主体…', '正在铺纸分层…'];

function useDraft(): { draft: Draft | null; loading: boolean } {
  const [params] = useSearchParams();
  const draftId = params.get('draft');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await getActiveDraft(draftId);
      if (alive) {
        setDraft(d);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [draftId]);
  return { draft, loading };
}

export default function ConvertPage() {
  const { draft, loading } = useDraft();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<IllustrationLayers | null>(null);
  const [config, setConfig] = useState<CutoutConfig | null>(null);
  const setDraftId = useFlowStore((s) => s.setDraftId);
  const [step, setStep] = useState(0);
  // StrictMode 双执行守卫：自动转换只触发一次
  const autoStartedRef = useRef(false);

  // 已转换的草稿（刷新/断点）直接回填预览
  useEffect(() => {
    if (draft?.stage === 'converted' && draft.layers) {
      setLayers(draft.layers as IllustrationLayers);
      setConfig((draft.cutoutConfig as CutoutConfig | undefined) ?? null);
    }
  }, [draft]);

  // 离开转换页：无本地 Worker 需要释放（管线已在后端，前端零 WASM 负担）

  // 进度文案轮播（转换进行中）
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setStep((s) => (s + 1) % PROGRESS_STEPS.length), 900);
    return () => clearInterval(id);
  }, [running]);

  const convert = useCallback(async () => {
    if (!draft) return;
    setRunning(true);
    setError(null);
    setLayers(null);
    setConfig(null);
    try {
      const result = await convertPhoto(draft.photoBlob);
      // 产物落盘：断点/刷新后仍可预览与收书
      const updated = await patchDraft(draft.id, {
        stage: 'converted',
        layers: {
          foreground: result.foreground,
          midground: result.midground ?? undefined,
          backdrop: result.backdrop ?? undefined,
          background: result.background,
          base: result.base,
          shadow: result.shadow,
        },
        cutoutConfig: result.config as unknown as Record<string, unknown>,
      });
      setDraftId(updated.id);
      setLayers({
        foreground: result.foreground,
        midground: result.midground,
        backdrop: result.backdrop,
        background: result.background,
        base: result.base,
        shadow: result.shadow,
      });
      setConfig(result.config);
    } catch (e) {
      // 后端连通/超时类错误直接展示（更可操作）；照片类错误给通用文案
      const msg = e instanceof Error ? e.message : '';
      setError(
        /转换服务|转换超时/.test(msg)
          ? msg
          : '这张照片暂时剪不动。照片还好好存着，点「再试一次」，或回上一步换一张。',
      );
    } finally {
      setRunning(false);
    }
  }, [draft, setDraftId]);

  // 首次进入且草稿未转换 → 自动开始（autoStartedRef 防 StrictMode 双跑）
  useEffect(() => {
    if (draft && draft.stage === 'captured' && !running && !error && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void convert();
    }
  }, [draft, running, error, convert]);

  if (loading) {
    return (
      <PageShell title="立绘转换" seal="剪">
        <p className="convert__state">正在翻开草稿…</p>
      </PageShell>
    );
  }

  if (!draft) {
    return (
      <PageShell title="立绘转换" seal="剪">
        <p className="convert__state">没有找到正在处理的照片。</p>
        <div className="convert__actions">
          <Button onClick={() => navigateTo('/capture')}>去选一张照片</Button>
        </div>
      </PageShell>
    );
  }

  const done = layers != null && config != null;

  return (
    <PageShell title="立绘转换" seal="剪">
      {running && (
        <div className="convert__running" role="status">
          <div className="convert__spinner" aria-hidden="true" />
          <p className="convert__step">{PROGRESS_STEPS[step]}</p>
          <p className="convert__note">照片会发送到你的转换服务器处理，处理完即弃；原图仍只留在本机。</p>
        </div>
      )}

      {!running && error && (
        <div className="convert__error" role="alert">
          <p className="convert__error-text">{error}</p>
          <div className="convert__actions">
            <Button onClick={() => void convert()}>再试一次</Button>
            <Button variant="ghost" onClick={() => navigateTo('/capture')}>
              回上一步换一张
            </Button>
          </div>
        </div>
      )}

      {done && (
        <div className="convert__done">
          <div className="convert__preview">
            <IllustrationScene layers={layers} style={{ height: '54vh', minHeight: 320 }} />
          </div>

          <div className="convert__meta" aria-label="立绘信息">
            <span className="convert__swatch" style={{ background: rgb(config.mainColor) }} />
            <span className="convert__meta-text">
              主体主色 · 深度 {Math.round(config.depth * 100)}%
              {config.usedFallback ? ' · 这张剪得一般，但也能收进书' : ''}
            </span>
          </div>

          <p className="convert__hint">左右轻移，看看这一页的层次</p>

          <div className="convert__actions">
            <Button size="lg" onClick={() => navigateTo(`/story?draft=${draft.id}`)}>
              开始讲故事
            </Button>
            <Button variant="ghost" disabled={running} onClick={() => void convert()}>
              重新转换
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function rgb(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}
