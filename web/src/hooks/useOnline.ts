// 在线状态 hook —— 全局断网横幅消费；navigator.onLine + online/offline 事件
import { useEffect, useState } from 'react';

const isBrowser = typeof navigator !== 'undefined';

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => (isBrowser ? navigator.onLine : true));

  useEffect(() => {
    if (!isBrowser) return;
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    // 事件可能在挂载前就已触发，挂载后再校准一次
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return online;
}
