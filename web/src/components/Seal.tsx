import type { CSSProperties } from 'react';

export interface SealProps {
  /** 印章上的字，默认「忆」 */
  char?: string;
  /** 边长（px），默认 30 */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** 朱红小落款印章 —— §4.3 签名元素：落款级、小面积、克制使用 */
export function Seal({ char = '忆', size = 30, className, style }: SealProps) {
  return (
    <span
      className={`huiyi-seal${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.58, ...style }}
      aria-hidden="true"
    >
      {char}
    </span>
  );
}
