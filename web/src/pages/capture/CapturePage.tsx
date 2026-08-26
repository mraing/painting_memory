// /capture 分享今天（§3.1 第 2 步）：拍照或相册选图 → 存 drafts 表 → 跳 /convert。
// 纯本地操作，断网可用（§3.2）；EXIF 方向归一化由立绘管线内部完成（docs/pipeline.md §4.1）。

import { useRef, useState, type ChangeEvent } from 'react';
import { PageShell } from '../../components/PageShell';
import { Button } from '../../components/ui/Button';
import { Seal } from '../../components/Seal';
import { navigateTo } from '../../router';
import { createDraft, useFlowStore } from '../../features/flow';
import './CapturePage.css';

export default function CapturePage() {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setDraftId = useFlowStore((s) => s.setDraftId);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同一文件再次选择也触发 change：清空 value 保证可重选
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('这个文件不是照片。挑一张 JPG 或 PNG 的照片试试。');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // 照片原样入库；EXIF 归一化交给立绘管线（转换页）处理
      const draft = await createDraft(file);
      setDraftId(draft.id);
      navigateTo(`/convert?draft=${draft.id}`);
    } catch {
      setError('照片没能存下来。请再选一次；如果一直失败，试试换一张小一点的照片。');
      setBusy(false);
    }
  };

  return (
    <PageShell title="分享今天" seal="今">
      <section className="capture">
        <p className="capture__lead">
          拍一张，或从相册里挑一张
          <br />
          今天想留下的照片。
        </p>

        <div className="capture__stage" aria-hidden="true">
          <Seal char="影" size={56} />
        </div>

        {error && (
          <p className="capture__error" role="alert">
            {error}
          </p>
        )}

        <div className="capture__actions">
          <Button size="lg" disabled={busy} onClick={() => cameraInputRef.current?.click()}>
            {busy ? '正在收好照片…' : '拍一张'}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => galleryInputRef.current?.click()}
          >
            从相册选一张
          </Button>
        </div>

        {/* 拍照：capture 属性拉起相机；相册：不带 capture 走系统选择器 */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handleFile}
        />
        <input ref={galleryInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      </section>
    </PageShell>
  );
}
