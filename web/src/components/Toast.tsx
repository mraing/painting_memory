// 全局轻提示（收进书等关键反馈）—— 消费 useFlowStore.toast，自动 2.6s 消失。
import { useEffect } from 'react';
import { useFlowStore } from '../features/flow';

export function Toast() {
  const toast = useFlowStore((s) => s.toast);
  const clearToast = useFlowStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(clearToast, 2600);
    return () => window.clearTimeout(id);
  }, [toast, clearToast]);

  if (!toast) return null;
  return (
    <div className="huiyi-toast" role="status">
      {toast}
    </div>
  );
}
