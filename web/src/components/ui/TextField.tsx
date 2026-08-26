import { forwardRef, type InputHTMLAttributes } from 'react';
import './ui.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {}

/** 基础输入框：token 化视觉基底（§4.3），纸底细边、聚焦陶土环 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { className, style, ...rest },
  ref,
) {
  const cls = ['huiyi-field'];
  if (className) cls.push(className);
  return <input ref={ref} className={cls.join(' ')} style={style} {...rest} />;
});
