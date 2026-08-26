// 全局断网横幅（§3.2 兜底：离线可翻书/存草稿，AI 对话不可用）—— 挂载于 providers 壳层
import { useOnline } from '../hooks/useOnline';
import './OfflineBanner.css';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="huiyi-offline" role="status">
      <span className="huiyi-offline__dot" aria-hidden="true" />
      离线中 —— 书与草稿仍可翻阅，AI 对话暂不可用
    </div>
  );
}
