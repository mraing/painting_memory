import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Seal } from '../../components/Seal';
import { navigateTo } from '../../router';
import './HomePage.css';

/** §4.5 hero 文案：约 12s 一轮缓慢跃动循环 */
const HERO_COPY = [
  '今天，想和我分享些什么？',
  '今天过得怎么样？',
  '有没有一张照片，值得收进书里？',
];

const PHRASE_MS = 12_000;

export default function HomePage() {
  const [active, setActive] = useState(0);

  // 12s 一轮轮换；tab 切回时立即对齐当前轮次
  useEffect(() => {
    const id = window.setInterval(() => setActive((a) => (a + 1) % HERO_COPY.length), PHRASE_MS);
    return () => window.clearInterval(id);
  }, []);

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }).format(new Date()),
    [],
  );

  return (
    <div className="hero">
      <header className="hero__head">
        <Seal char="忆" size={30} />
        <span className="hero__brand">绘忆</span>
        <time className="hero__date">{today}</time>
      </header>

      <section className="hero__copy" aria-live="polite">
        {HERO_COPY.map((line, i) => (
          <p
            key={line}
            className={`hero__phrase${i === active ? ' is-active' : ''}`}
            aria-hidden={i !== active}
          >
            {line}
          </p>
        ))}
      </section>

      <footer className="hero__actions">
        <Button size="lg" onClick={() => navigateTo('/capture')}>
          拍照 / 从相册选一张
        </Button>
        <Button variant="ghost" className="hero__book" onClick={() => navigateTo('/book')}>
          翻开我的书
        </Button>
      </footer>

      <footer className="hero__foot">
        <Button variant="ghost" className="hero__settings" onClick={() => navigateTo('/settings')}>
          设置 · 隐私
        </Button>
      </footer>
    </div>
  );
}
