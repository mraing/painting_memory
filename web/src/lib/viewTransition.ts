// View Transitions API 封装：不支持的浏览器（老 iOS Safari）静默退化
type DocumentWithTransition = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => {
    finished: Promise<void>;
    ready: Promise<void>;
  };
};

export function navigateWithViewTransition(update: () => void | Promise<void>): void {
  const doc = document as DocumentWithTransition;
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(update);
  } else {
    void update();
  }
}
