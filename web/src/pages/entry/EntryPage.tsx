// /entry 生成日记 + 收进书（§3.1 第 5/6 步 / §2 决策 7）：
// 绘本页版式：上方立绘、下半部日记（画面第一）；日记第二人称回望式 150~400 字；
// 「收进书」→ 写 pages 表（立绘图层 + 配置 + 日记 + 时间 + 月份）→ 提示 → 跳 /book。
// 断点兜底：日记生成后落盘 draft.diaryText，刷新/重进不重复生成（§3.2）。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { Button } from '../../components/ui/Button';
import { IllustrationScene, type IllustrationLayers } from '../../three/IllustrationScene';
import { navigateTo } from '../../router';
import { ai } from '../../features/ai';
import { db, type Conversation, type Draft } from '../../db/db';
import {
  getActiveDraft,
  monthKeyOf,
  pageFromDraft,
  patchDraft,
  removeDraft,
  useFlowStore,
} from '../../features/flow';
import './EntryPage.css';

export default function EntryPage() {
  const draftId = useSearchParams()[0].get('draft');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const setDraftId = useFlowStore((s) => s.setDraftId);
  const showToast = useFlowStore((s) => s.showToast);
  const generatedRef = useRef(false);

  // 载入草稿 + 对话
  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await getActiveDraft(draftId);
      if (!alive) return;
      if (!d) {
        setLoading(false);
        return;
      }
      setDraft(d);
      setDraftId(d.id);
      const c = (await db.conversations.where('draftId').equals(d.id).first()) ?? null;
      if (!alive) return;
      setConv(c);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [draftId, setDraftId]);

  // 流程兜底：还没转换/没聊 → 先走前置步骤
  useEffect(() => {
    if (!draft) return;
    if (draft.stage === 'captured') navigateTo(`/convert?draft=${draft.id}`);
    else if (draft.stage === 'converted') navigateTo(`/story?draft=${draft.id}`);
  }, [draft]);

  // 生成日记（草稿已有 diaryText 则直接展示；生成后落盘，断点不丢）
  useEffect(() => {
    if (!draft || !conv || draft.diaryText) return;
    if (draft.stage !== 'chatted') return;
    if (generatedRef.current) return;
    generatedRef.current = true;
    setGenerating(true);
    setError(null);
    (async () => {
      try {
        const interpretation = (draft.interpretation ??
          {}) as unknown as Parameters<typeof ai.diary>[1];
        const result = await ai.diary(
          conv.messages.map((m) => ({ role: m.role, text: m.text })),
          interpretation,
        );
        const updated = await patchDraft(draft.id, { diaryText: result.text });
        setDraft(updated);
      } catch {
        generatedRef.current = false; // 允许重试
        setError('日记没写成。照片、对话都还在，点「再写一次」试试。');
      } finally {
        setGenerating(false);
      }
    })();
  }, [draft, conv]);

  const saveToBook = useCallback(async () => {
    if (!draft || !draft.diaryText || saving) return;
    setSaving(true);
    try {
      await pageFromDraft(draft);
      await removeDraft(draft.id);
      showToast('这一页已被收进你的书');
      navigateTo('/book');
    } catch {
      setError('这一页没能收进书。草稿还留着，再点一次「收进书」。');
      setSaving(false);
    }
  }, [draft, saving, showToast]);

  if (loading) {
    return (
      <PageShell title="今天这一页" seal="页">
        <p className="entry__state">正在翻开这一页…</p>
      </PageShell>
    );
  }

  if (!draft) {
    return (
      <PageShell title="今天这一页" seal="页">
        <p className="entry__state">没有找到正在写的一页。</p>
        <div className="entry__center-actions">
          <Button onClick={() => navigateTo('/capture')}>去选一张照片</Button>
        </div>
      </PageShell>
    );
  }

  // 前置步骤未完成：等重定向（/convert 或 /story）
  if (draft.stage !== 'chatted') {
    return (
      <PageShell title="今天这一页" seal="页">
        <p className="entry__state">正在翻到这一页…</p>
      </PageShell>
    );
  }

  if (!conv) {
    return (
      <PageShell title="今天这一页" seal="页">
        <p className="entry__state">没有找到这一页的对话。</p>
        <div className="entry__center-actions">
          <Button onClick={() => navigateTo('/capture')}>去选一张照片</Button>
        </div>
      </PageShell>
    );
  }

  const layers = draft.layers as IllustrationLayers | undefined;
  const diary = draft.diaryText;

  return (
    <PageShell title="今天这一页" seal="页">
      {error && (
        <p className="entry__error" role="alert">
          {error}
        </p>
      )}

      {(generating || (!diary && draft.stage === 'chatted')) && (
        <div className="entry__generating" role="status">
          <div className="convert__spinner" aria-hidden="true" />
          <p>正在把今天写成日记…</p>
        </div>
      )}

      {diary && (
        <div className="entry__page">
          <p className="entry__date">{monthLabel()}</p>

          <div className="entry__scene">
            {layers ? (
              <IllustrationScene layers={layers} style={{ height: '46vh', minHeight: 300 }} />
            ) : (
              <div className="entry__scene-empty">这一页的立绘还没准备好</div>
            )}
          </div>

          <blockquote className="entry__diary">{diary}</blockquote>

          <div className="entry__actions">
            <Button size="lg" disabled={saving} onClick={() => void saveToBook()}>
              {saving ? '正在收进书…' : '收进书'}
            </Button>
            <Button variant="ghost" onClick={() => navigateTo('/')}>
              先不收了，回首页
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function monthLabel(): string {
  const d = new Date();
  const key = monthKeyOf(d);
  const [, mm] = key.split('-');
  const names = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  return `${d.getFullYear()} 年 ${names[Number(mm) - 1] ?? mm} 月 ${String(d.getDate()).padStart(2, '0')} 日`;
}
