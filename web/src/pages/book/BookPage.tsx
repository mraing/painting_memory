// 书浏览页（§3.1.7 回看 / §2 决策 8）：
// 一本总书 · 按月分章 · 开书落最新页 · 3D 翻页（BookViewer，§6.2 第一层）；
// 点按单页 → 完整 3D 场景（PageDetailView，第二层）；长按 → 删除确认（§9）。
// 数据来自 features/book（真实 pages 表；t6 未完成时 mock 兜底）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { Button } from '../../components/ui/Button';
import { Seal } from '../../components/Seal';
import { BookViewer, type BookPage3D } from '../../three/BookViewer';
import { navigateTo } from '../../router';
import {
  deleteBookPage,
  groupChapters,
  loadBookPages,
  monthCn,
  monthShort,
  type BookPageItem,
} from '../../features/book';
import { PageDetailView } from './PageDetailView';
import './BookPage.css';

export default function BookPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BookPageItem[]>([]);
  const [isMock, setIsMock] = useState(false);
  const [current, setCurrent] = useState(0);
  /** 章节跳转：key 变化 → BookViewer 重挂到目标页（轻量、极少触发） */
  const [jumpKey, setJumpKey] = useState(0);
  const [jumpIndex, setJumpIndex] = useState<number | null>(null);
  /** 单页 3D 叠加层（§6.2 第二层） */
  const [detail, setDetail] = useState<BookPageItem | null>(null);
  /** 长按待删页（确认对话框） */
  const [pendingDelete, setPendingDelete] = useState<BookPageItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await loadBookPages();
        if (!alive) return;
        setItems(result.items);
        setIsMock(result.isMock);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const chapters = useMemo(() => groupChapters(items.map((p) => p.month)), [items]);

  const viewerPages = useMemo<BookPage3D[]>(
    () => items.map((p) => ({ id: p.id, month: p.month, image: p.image })),
    [items],
  );

  const openDetail = useCallback(
    (index: number) => setDetail(items[index] ?? null),
    [items],
  );

  const requestDelete = useCallback(
    (index: number) => setPendingDelete(items[index] ?? null),
    [items],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteBookPage(pendingDelete.id);
      setItems((list) => list.filter((p) => p.id !== pendingDelete.id));
      setCurrent((c) => Math.max(0, c - 1));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }, [pendingDelete]);

  /** 章节跳转：重挂 BookViewer 到章首页 */
  const jumpTo = useCallback((index: number) => {
    setCurrent(index);
    setJumpIndex(index);
    setJumpKey((k) => k + 1);
  }, []);

  const latest = items.length > 0 ? items.length - 1 : 0;
  const activeChapter = useMemo(() => {
    const month = items[current]?.month;
    return chapters.find((ch) => ch.month === month) ?? null;
  }, [chapters, current, items]);

  if (loading) {
    return (
      <PageShell title="时光绘本" seal="忆">
        <p className="book-page__loading">正在翻开书…</p>
      </PageShell>
    );
  }

  if (items.length === 0) {
    // 空书态（侘寂风）：引导回首页拍第一张
    return (
      <PageShell title="时光绘本" seal="忆">
        <section className="book-empty">
          <Seal char="空" size={44} />
          <p className="book-empty__title">书还是空的。</p>
          <p className="book-empty__sub">
            拍下今天的第一张照片，
            <br />
            它就会成为这本书的第一页。
          </p>
          <div className="book-empty__actions">
            <Button size="lg" onClick={() => navigateTo('/capture')}>
              去拍第一张
            </Button>
            <Button variant="ghost" onClick={() => navigateTo('/')}>
              先回首页
            </Button>
          </div>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell title="时光绘本" seal="忆">
      <p className="book-page__hint">
        拖动翻页 · 点按单页看立体 · 长按抽走
        {isMock && <span className="book-page__mock">演示数据</span>}
      </p>

      <BookViewer
        key={jumpKey}
        pages={viewerPages}
        initialPage={jumpIndex ?? latest}
        cover={{ title: '时光绘本', subtitle: '岁月 · 光影 · 你' }}
        onPageChange={setCurrent}
        onPageTap={openDetail}
        onLongPress={requestDelete}
        style={{ aspectRatio: '10 / 8', maxHeight: '76vh' }}
      />

      <nav className="book-chapters" aria-label="月份章节">
        {chapters.map((ch) => {
          const active = activeChapter?.month === ch.month;
          return (
            <button
              key={ch.month}
              type="button"
              className={`book-chapters__tab${active ? ' is-active' : ''}`}
              onClick={() => jumpTo(ch.index)}
              aria-current={active ? 'true' : undefined}
            >
              {monthCn(ch.month)}
              <span className="book-chapters__count">{ch.count}</span>
            </button>
          );
        })}
      </nav>

      <p className="book-page__where">
        第 {current + 1} 页 · 共 {items.length} 页
        {activeChapter ? ` · ${monthShort(activeChapter.month)}` : ''}
      </p>

      {detail && <PageDetailView item={detail} onClose={() => setDetail(null)} />}

      {pendingDelete && (
        <div
          className="book-modal"
          role="dialog"
          aria-modal="true"
          aria-label="抽走这一页"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setPendingDelete(null);
          }}
        >
          <div className="book-modal__card">
            <p className="book-modal__title">抽走这一页？</p>
            <p className="book-modal__sub">这一页会从书里消失，立绘与日记一并移除。</p>
            <div className="book-modal__actions">
              <Button variant="ghost" disabled={deleting} onClick={() => setPendingDelete(null)}>
                再想想
              </Button>
              <Button variant="accent" disabled={deleting} onClick={confirmDelete}>
                {deleting ? '正在抽走…' : '抽走'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
