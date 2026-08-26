// Mock 画像提取器测试 —— 关键词/规则启发式，输出形状对齐后端 DTO（§8.4）
import { describe, expect, it } from 'vitest';
import { extractProfileCandidates, type ExtractInput } from './extractor';

describe('extractProfileCandidates 人物', () => {
  it('亲属称谓 → person（关系 + 附近特质）', () => {
    const out = extractProfileCandidates([
      { role: 'user', text: '我妈妈做菜很好吃，拿手菜是红烧肉' },
    ]);
    const mom = out.find((c) => c.kind === 'person' && c.name === '妈妈');
    expect(mom).toMatchObject({ kind: 'person', name: '妈妈', relation: '母亲' });
    expect(mom && 'trait' in mom ? mom.trait : '').toContain('做菜');
  });

  it('「我妈」归一化为 妈妈', () => {
    const out = extractProfileCandidates([{ role: 'user', text: '我妈那天特意做了红烧肉' }]);
    expect(out.some((c) => c.kind === 'person' && c.name === '妈妈')).toBe(true);
  });

  it('猫/狗 → 宠物 person', () => {
    const out = extractProfileCandidates([{ role: 'user', text: '我家猫很安静，狗也很乖' }]);
    expect(out.some((c) => c.kind === 'person' && c.name === '猫' && c.relation === '宠物')).toBe(
      true,
    );
    expect(out.some((c) => c.kind === 'person' && c.name === '狗' && c.relation === '宠物')).toBe(
      true,
    );
  });

  it('同一段文本重复称谓只产出一条（去重）', () => {
    const out = extractProfileCandidates([{ role: 'user', text: '妈妈妈妈都夸妈妈做菜好' }]);
    expect(out.filter((c) => c.kind === 'person' && c.name === '妈妈')).toHaveLength(1);
  });

  it('AI 的发言不算事实（只提取用户发言）', () => {
    const out = extractProfileCandidates([
      { role: 'ai', text: '你妈妈做菜一定很好吃吧？' },
      { role: 'user', text: '是啊，我妈妈拿手菜是红烧肉' },
    ]);
    expect(out.filter((c) => c.kind === 'person' && c.name === '妈妈')).toHaveLength(1);
  });
});

describe('extractProfileCandidates 地点', () => {
  it('童年/暑假 上下文 → place + meaning', () => {
    const out = extractProfileCandidates([
      { role: 'user', text: '外婆家是我童年暑假的记忆' },
    ]);
    const place = out.find((c) => c.kind === 'place' && c.name === '外婆家');
    expect(place).toBeTruthy();
    expect(place && 'meaning' in place ? place.meaning : '').toContain('童年');
  });

  it('无意义上下文的地点也提取（meaning 缺省）', () => {
    const out = extractProfileCandidates([{ role: 'user', text: '今天去了公园散步' }]);
    const place = out.find((c) => c.kind === 'place' && c.name === '公园');
    expect(place).toBeTruthy();
    expect(place && 'meaning' in place ? place.meaning : undefined).toBeUndefined();
  });
});

describe('extractProfileCandidates 偏好/日期/习惯', () => {
  it('喜欢/讨厌 → preference（topic + note）', () => {
    const out = extractProfileCandidates([{ role: 'user', text: '我喜欢雨天，讨厌夏天' }]);
    expect(out).toContainEqual({ kind: 'preference', topic: '雨天', note: '喜欢雨天' });
    expect(out).toContainEqual({ kind: 'preference', topic: '夏天', note: '讨厌夏天' });
  });

  it('M月D日 → importantDate（当前年份，附上下文）', () => {
    const out = extractProfileCandidates([
      { role: 'user', text: '6月1日我们搬家到新城市，那天很特别' },
    ]);
    const year = new Date().getFullYear();
    const d = out.find((c) => c.kind === 'importantDate');
    expect(d).toMatchObject({ kind: 'importantDate', date: `${year}-06-01` });
    expect(d && 'note' in d ? d.note : '').toContain('搬家');
  });

  it('叙述习惯 → habit', () => {
    const out = extractProfileCandidates([
      { role: 'user', text: '我讲故事喜欢先交代天气再讲人' },
    ]);
    expect(out).toContainEqual({
      kind: 'habit',
      topic: '叙述习惯',
      note: '讲故事时喜欢先交代天气',
    });
  });

  it('一次性事件（「今天下雨」）不提取', () => {
    const out = extractProfileCandidates([{ role: 'user', text: '今天下雨了，没出门' }]);
    expect(out).toHaveLength(0);
  });
});

describe('extractProfileCandidates date 透传', () => {
  it('date 参数透传到 person/place 候选', () => {
    const out = extractProfileCandidates(
      [{ role: 'user', text: '我妈妈做菜很好吃，外婆家是童年的记忆' }],
      '2025-01-02',
    );
    const mom = out.find((c) => c.kind === 'person') as Extract<
      (typeof out)[number],
      { kind: 'person' }
    >;
    const place = out.find((c) => c.kind === 'place') as Extract<
      (typeof out)[number],
      { kind: 'place' }
    >;
    expect(mom.date).toBe('2025-01-02');
    expect(place.date).toBe('2025-01-02');
  });
});

describe('extractProfileCandidates 组合场景（fixture 对话）', () => {
  it('完整引导对话 → 人物/地点/偏好/习惯混合候选', () => {
    const conversation: ExtractInput[] = [
      { role: 'ai', text: '画面里这只小家伙，是你们家的猫吧？' },
      { role: 'user', text: '对，我家猫特别粘人，妈妈总说它像个小孩子' },
      { role: 'ai', text: '听起来它和家里人都很亲。' },
      { role: 'user', text: '是啊，外婆家的老院子也是它最爱待的地方，我讲故事喜欢先交代天气' },
    ];
    const out = extractProfileCandidates(conversation);
    expect(out.some((c) => c.kind === 'person' && c.name === '妈妈' && c.relation === '母亲')).toBe(
      true,
    );
    expect(out.some((c) => c.kind === 'person' && c.name === '猫' && c.relation === '宠物')).toBe(
      true,
    );
    expect(out.some((c) => c.kind === 'place' && c.name === '外婆家')).toBe(true);
    expect(out.some((c) => c.kind === 'habit')).toBe(true);
  });
});
