// 设置页 —— §7 隐私说明 + §3.2 数据逃生口（全部导出）+ 云端档案删除入口
import { useEffect, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { Button } from '../../components/ui/Button';
import { downloadExportZip } from '../../features/export';
import { deleteCloudArchive } from '../../features/archive';
import { useFlowStore } from '../../features/flow';
import { db } from '../../db/db';
import './SettingsPage.css';

export default function SettingsPage() {
  const showToast = useFlowStore((s) => s.showToast);
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [meta, setMeta] = useState({ pages: 0, drafts: 0, profile: false });

  useEffect(() => {
    void (async () => {
      const [pages, drafts, profile] = await Promise.all([
        db.pages.count(),
        db.drafts.count(),
        db.profile.count(),
      ]);
      setMeta({ pages, drafts, profile: profile > 0 });
    })();
  }, [busy]);

  const onExport = async () => {
    setBusy('export');
    try {
      await downloadExportZip();
      showToast('已导出 zip，请查收下载');
    } catch (e) {
      showToast(`导出失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy(null);
    }
  };

  const onDeleteArchive = async () => {
    const ok = window.confirm('将清除本机的云端档案副本（画像与解读日志）。\n照片与书页不会受影响。确定继续吗？');
    if (!ok) return;
    setBusy('delete');
    try {
      const result = await deleteCloudArchive();
      showToast(`已清除档案副本（画像重置，解读 ${result.cleared.interpretations} 条）`);
    } catch (e) {
      showToast(`清除失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageShell title="设置">
      <div className="settings">
        <section className="settings__section">
          <h2 className="settings__title">隐私说明</h2>
          <div className="settings__body">
            <ul className="settings__list">
              <li>原图与日记只保存在你的设备上（IndexedDB）；做立绘时，照片会发送到你的转换服务器处理，服务器处理完即弃、不保存原图。</li>
              <li>AI 理解照片时，仅发送压缩至 512px 的一次性缩略图，用后即弃，不存原图。</li>
              <li>云端只存：立绘产物、AI 解读日志、画像档案（当前为本地副本，尚未接入云端）。</li>
              <li>你可以随时用下方「全部导出」带走所有数据，或「删除云端档案」清空画像与解读记录。</li>
            </ul>
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__title">数据逃生口</h2>
          <div className="settings__body">
            浏览器缓存被清、换手机之前，先导出一次：zip 内含原图、立绘图层与日记 JSON。
          </div>
          <div className="settings__actions">
            <Button variant="outline" onClick={onExport} disabled={busy !== null}>
              {busy === 'export' ? '正在打包…' : '全部导出（zip）'}
            </Button>
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__title">云端档案</h2>
          <div className="settings__body">
            删除我所有云端档案：画像与解读日志的本地副本将被清除，照片与书页不受影响。
          </div>
          <div className="settings__actions">
            <Button variant="accent" onClick={onDeleteArchive} disabled={busy !== null}>
              {busy === 'delete' ? '正在清除…' : '删除我所有云端档案'}
            </Button>
          </div>
          <p className="settings__muted">
            本轮为纯前端原型，此操作清除本地档案副本；后端接入后将对齐 DELETE /api/archive
            接口（见 docs/api-contract.md），一并删除云端立绘产物、解读日志与画像。
          </p>
        </section>

        <section className="settings__section">
          <h2 className="settings__title">关于</h2>
          <p className="settings__meta">
            <span>绘忆 · 时光绘本 v0.3（原型）</span>
            <span>书页 {meta.pages}</span>
            <span>草稿 {meta.drafts}</span>
            <span>画像 {meta.profile ? '已建立' : '未建立'}</span>
          </p>
        </section>
      </div>
    </PageShell>
  );
}
