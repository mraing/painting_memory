// R3F Canvas 运行期错误兜底（t9 降级路线）：弱显卡/GPU 驱动下 Canvas 渲染崩溃时
// 回退到静态降级版，而不是整页白屏（此前无边界：WebGL 运行期异常会放倒整个页面）。
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface GLBoundaryProps {
  /** 出错时渲染的兜底内容（通常为静态降级版） */
  fallback: ReactNode;
  children: ReactNode;
}

interface GLBoundaryState {
  failed: boolean;
}

export class GLBoundary extends Component<GLBoundaryProps, GLBoundaryState> {
  state: GLBoundaryState = { failed: false };

  static getDerivedStateFromError(): GLBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('[GLBoundary] 3D 渲染失败，已降级静态版：', error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
