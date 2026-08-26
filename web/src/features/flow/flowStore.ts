// 主流程会话态（zustand）—— 跨页共享的轻量状态：当前草稿 id 与全局 toast。
// 持久数据一律走 IndexedDB（features/flow/flowOps.ts），此 store 不做持久化。

import { create } from 'zustand';

interface FlowState {
  /** 当前流程草稿 id（各页经 URL ?draft= 与 getActiveDraft 恢复，此为会话内快捷引用） */
  draftId: string | null;
  setDraftId(id: string | null): void;
  /** 全局轻提示（如「这一页已被收进你的书」），Toast 组件消费 */
  toast: string | null;
  showToast(message: string): void;
  clearToast(): void;
}

export const useFlowStore = create<FlowState>((set) => ({
  draftId: null,
  setDraftId: (id) => set({ draftId: id }),

  toast: null,
  showToast: (message) => set({ toast: message }),
  clearToast: () => set({ toast: null }),
}));
