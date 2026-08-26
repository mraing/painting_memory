// 单页完整 3D 场景（§6.2 第二层：进入时构建、退出时释放）：
// 立绘图层交互预览（左右轻移视差）+ 日记下半部（§3.1.5 画面第一）。
// 全屏叠加层；IllustrationScene 卸载时自动 dispose 纹理/几何。

import { useEffect } from 'react';
import { IllustrationScene } from '../../three/IllustrationScene';
import { Button } from '../../components/ui/Button';
import { monthCn, monthShort, type BookPageItem } from '../../features/book';

export interface PageDetailViewProps {
  item: BookPageItem;
  onClose: () => void;
}

export function PageDetailView({ item, onClose }: PageDetailViewProps) {
  // Esc 合上
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="page-detail" role="dialog" aria-modal="true" aria-label="单页立体场景">
      <header className="page-detail__head">
        <span className="page-detail__month">
          {monthCn(item.month)} · {monthShort(item.month)}
        </span>
        <Button variant="ghost" onClick={onClose}>
          合上
        </Button>
      </header>

      <div className="page-detail__scene">
        <IllustrationScene layers={item.layers} style={{ height: '56vh', minHeight: 320 }} />
      </div>

      <p className="page-detail__hint">左右轻移，看看这一页的层次</p>

      {item.diary ? (
        <blockquote className="page-detail__diary">{item.diary}</blockquote>
      ) : (
        <p className="page-detail__diary page-detail__diary--empty">这一页还没有日记。</p>
      )}
    </div>
  );
}
