import { forwardRef, type ButtonHTMLAttributes } from 'react';
import './ui.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 实心墨 solid（主行动）/ 描边纸 outline（次级）/ 朱红细签 accent（落款级强调）/ 无声 ghost（弱入口） */
  variant?: 'solid' | 'outline' | 'accent' | 'ghost';
  size?: 'lg' | 'md';
}

/** 基础按钮：token 化视觉基底（§4.3），无 hover 依赖，触摸 :active 反馈 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'solid', size = 'md', className, style, type = 'button', ...rest },
  ref,
) {
  const cls = ['huiyi-btn', `huiyi-btn--${variant}`, `huiyi-btn--${size}`];
  if (className) cls.push(className);
  return <button ref={ref} type={type} className={cls.join(' ')} style={style} {...rest} />;
});
