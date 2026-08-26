// 冒烟测试：Mock AI 适配器可调用、返回形状符合契约
import { describe, expect, it } from 'vitest';
import { createMockAiAdapter, type PhotoInterpretation } from './mockAdapter';
import { createEmptyProfile } from '../memory';

describe('Mock AI 适配器', () => {
  it('understand 返回结构化照片解读', async () => {
    const ai = createMockAiAdapter();
    const blob = new Blob(['fake-photo'], { type: 'image/jpeg' });
    const it2: PhotoInterpretation = await ai.understand(blob);
    expect(it2.subject).toBeTruthy();
    expect(it2.background).toBeTruthy();
    expect(it2.foreground).toBeTruthy();
    expect(it2.mood).toBeTruthy();
    expect(Array.isArray(it2.elements)).toBe(true);
    expect(it2.elements.length).toBeGreaterThan(0);
  });

  it('chat 首轮用确认式提问开场，随后可继续追问', async () => {
    const ai = createMockAiAdapter();
    await ai.understand(new Blob(['x']));
    const opener = await ai.chat([], createEmptyProfile(), []);
    expect(opener).toBeTruthy();
    const follow = await ai.chat(
      [
        { role: 'ai', text: opener },
        { role: 'user', text: '那是我家的猫' },
      ],
      createEmptyProfile(),
      [],
    );
    expect(follow).toContain('猫');
  });

  it('diary 产出 150~400 字的第二人称回望式日记', async () => {
    const ai = createMockAiAdapter();
    const it2 = await ai.understand(new Blob(['x']));
    const result = await ai.diary(
      [
        { role: 'ai', text: '那天发生了什么？' },
        { role: 'user', text: '阳光很好，我们在窗边待了一下午。' },
      ],
      it2,
    );
    expect(result.text.length).toBeGreaterThanOrEqual(150);
    expect(result.text.length).toBeLessThanOrEqual(400);
    expect(result.text).toContain('你');
    expect(Array.isArray(result.profileCandidates)).toBe(true);
  });

  it('diary 同一次调用顺带输出候选画像更新（§8.4 零成本技巧）', async () => {
    const ai = createMockAiAdapter();
    const it2 = await ai.understand(new Blob(['x']));
    const result = await ai.diary(
      [
        { role: 'ai', text: '这是你家的小家伙吗？' },
        { role: 'user', text: '对，我妈妈做菜很好吃，外婆家是我童年的记忆' },
      ],
      it2,
    );
    const candidates = result.profileCandidates;
    expect(candidates.some((c) => c.kind === 'person' && c.name === '妈妈')).toBe(true);
    expect(candidates.some((c) => c.kind === 'place' && c.name === '外婆家')).toBe(true);
  }, 10000);

  it('所有调用带 600ms 以上的模拟延迟', async () => {
    const ai = createMockAiAdapter();
    const start = Date.now();
    await ai.understand(new Blob(['x']));
    expect(Date.now() - start).toBeGreaterThanOrEqual(590);
  }, 10000);
});
