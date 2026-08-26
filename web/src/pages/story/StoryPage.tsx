// /story AI 引导对话（§3.1 第 4 步 / §2 决策 4）：
// 一次一问、气泡对话、打字中指示；2~4 轮后 AI 主动提议收束，随时可「写好啦」。
// 断网 → 禁用对话但草稿与已有对话保留（§3.2）；中途退出 → 对话落 conversations 表可续聊；
// 每次请求前注入画像 + 近期日记（features/memory buildChatInjection，§8.4）。

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageShell } from '../../components/PageShell';
import { Button } from '../../components/ui/Button';
import { navigateTo } from '../../router';
import { ai, type ChatTurn } from '../../features/ai';
import { buildChatInjection } from '../../features/memory';
import {
  appendMessage,
  finishConversation,
  getActiveDraft,
  getOrCreateConversation,
  patchDraft,
  useFlowStore,
} from '../../features/flow';
import type { Conversation, Draft } from '../../db/db';
import './StoryPage.css';

export default function StoryPage() {
  const draftId = useSearchParams()[0].get('draft');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  const setDraftId = useFlowStore((s) => s.setDraftId);
  const openedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 断网侦听（§3.2：离线禁用对话，草稿保留）
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // 载入草稿 + 对话（断点续聊）
  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await getActiveDraft(draftId);
      if (!alive) return;
      if (!d) {
        setLoading(false);
        return;
      }
      setDraft(d);
      setDraftId(d.id);
      const c = await getOrCreateConversation(d.id);
      if (!alive) return;
      setConv(c);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [draftId, setDraftId]);

  const ask = useCallback(
    async (history: ChatTurn[]) => {
      setTyping(true);
      setError(null);
      try {
        // 请求前注入画像 + 近期日记（§8.4；Mock 适配器内部渲染进 prompt）
        const { profile, recentDiaries } = await buildChatInjection();
        return await ai.chat(history, profile, recentDiaries);
      } finally {
        setTyping(false);
      }
    },
    [],
  );

  // 首轮：确保照片解读落盘 + AI 确认式开场（§2 决策 4；StrictMode 双执行安全）
  useEffect(() => {
    if (!draft || !conv || openedRef.current) return;
    if (conv.messages.length > 0) return;
    openedRef.current = true;
    (async () => {
      try {
        let interpretation: Record<string, unknown> | undefined = draft.interpretation;
        if (!interpretation) {
          interpretation = (await ai.understand(draft.photoBlob)) as unknown as Record<
            string,
            unknown
          >;
          const updated = await patchDraft(draft.id, { interpretation });
          setDraft(updated);
        }
        const opener = await ask([]);
        const next = await appendMessage(conv, { role: 'ai', text: opener });
        setConv(next);
      } catch {
        openedRef.current = false; // 允许重试开场
        setError('AI 暂时没接上话。稍等片刻，点「再试一次」。对话与照片都还在。');
      }
    })();
  }, [draft, conv, ask]);

  const send = useCallback(
    async (text: string) => {
      if (!conv || !text.trim() || typing) return;
      const next = await appendMessage(conv, { role: 'user', text: text.trim() });
      setConv(next);
      setInput('');
      try {
        const history: ChatTurn[] = next.messages.map((m) => ({ role: m.role, text: m.text }));
        const reply = await ask(history);
        const withReply = await appendMessage(next, { role: 'ai', text: reply });
        setConv(withReply);
      } catch {
        setError('这句话没送到。再试一次，或者直接点「写好啦」收束。');
      }
    },
    [conv, typing, ask],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const wrapUp = useCallback(async () => {
    if (!draft || !conv || typing) return;
    try {
      await finishConversation(conv);
      await patchDraft(draft.id, { stage: 'chatted' });
      navigateTo(`/entry?draft=${draft.id}`);
    } catch {
      setError('收束没存下来。再点一次「写好啦」试试。');
    }
  }, [draft, conv, typing]);

  /** 重试最后一轮 AI 应答（开场失败 / 发送失败都走这里） */
  const retryLastTurn = useCallback(async () => {
    if (!conv) return;
    setError(null);
    try {
      const history: ChatTurn[] = conv.messages.map((m) => ({ role: m.role, text: m.text }));
      const reply = await ask(history);
      const withReply = await appendMessage(conv, { role: 'ai', text: reply });
      setConv(withReply);
    } catch {
      setError('还是没接上。再试一次，或直接点「写好啦」收束。');
    }
  }, [conv, ask]);

  // 已经聊完（stage=chatted）→ 自动翻到日记页
  useEffect(() => {
    if (draft?.stage === 'chatted' && conv) {
      navigateTo(`/entry?draft=${draft.id}`);
    }
  }, [draft, conv]);

  // 新消息自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv?.messages.length, typing]);

  if (loading) {
    return (
      <PageShell title="聊聊这张照片" seal="谈">
        <p className="story__state">正在展开对话…</p>
      </PageShell>
    );
  }

  if (!draft || !conv) {
    return (
      <PageShell title="聊聊这张照片" seal="谈">
        <p className="story__state">没有找到正在聊的照片。</p>
        <div className="story__center-actions">
          <Button onClick={() => navigateTo('/capture')}>去选一张照片</Button>
        </div>
      </PageShell>
    );
  }

  // 流程兜底：还没转换 → 去转换
  if (draft.stage === 'captured') {
    return (
      <PageShell title="聊聊这张照片" seal="谈">
        <p className="story__state">这张照片还没剪成立绘。</p>
        <div className="story__center-actions">
          <Button onClick={() => navigateTo(`/convert?draft=${draft.id}`)}>先去转换</Button>
        </div>
      </PageShell>
    );
  }
  // 已经聊完：等自动翻页到日记页
  if (draft.stage === 'chatted') {
    return (
      <PageShell title="聊聊这张照片" seal="谈">
        <p className="story__state">正在翻到日记页…</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="聊聊这张照片" seal="谈">
      <div className="story__bar">
        <span className="story__bar-hint">一次一问 · 想到什么说什么</span>
        <Button variant="accent" disabled={typing || !online} onClick={() => void wrapUp()}>
          写好啦
        </Button>
      </div>

      {!online && (
        <p className="story__offline" role="status">
          离线中：对话先聊不了。照片和已说的话都存好了，联网后回来继续。
        </p>
      )}

      <div className="story__scroll" ref={scrollRef}>
        {conv.messages.map((m, i) => (
          <div key={i} className={`story__row story__row--${m.role}`}>
            <div className="story__bubble">{m.text}</div>
          </div>
        ))}
        {typing && (
          <div className="story__row story__row--ai">
            <div className="story__bubble story__typing" aria-label="AI 正在输入">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {error && (
          <div className="story__error" role="alert">
            <span>{error}</span>
            <Button variant="ghost" onClick={() => void retryLastTurn()}>
              再试一次
            </Button>
          </div>
        )}
      </div>

      <form className="story__input" onSubmit={handleSubmit}>
        <input
          className="huiyi-field"
          value={input}
          disabled={typing || !online}
          placeholder={online ? '说点什么…' : '离线中'}
          onChange={(e) => setInput(e.target.value)}
          enterKeyHint="send"
          autoComplete="off"
        />
        <Button type="submit" disabled={typing || !online || !input.trim()}>
          发送
        </Button>
      </form>
    </PageShell>
  );
}
