import type { ReactNode } from 'react';
import { Seal } from './Seal';

export interface PageShellProps {
  title: string;
  /** 标题前的小落款印章（默认「忆」；不需要时传 null） */
  seal?: string | null;
  children?: ReactNode;
}

/** 路由壳：只管布局与导航基底（§5.6），侘寂 token 化视觉 */
export function PageShell({ title, seal = '忆', children }: PageShellProps) {
  return (
    <main className="huiyi-page">
      <h1 className="huiyi-page__title">
        {seal !== null && <Seal char={seal} size={24} />}
        {title}
      </h1>
      {children}
    </main>
  );
}
