import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDraft, validateDraft } from '../src/local-preview.js';

const candidate = { channel: 'steam' as const, title: 'Sample Game', summary: 'An online co-op horror game with up to 6 players.' };

test('a skipped item need not invent a title or body', () => {
  assert.equal(validateDraft({ decision: 'skip', title: '', claims: [], reason: 'insufficient source' }, candidate).decision, 'skip');
});

test('a complete short Chinese evidence quote is accepted', () => {
  assert.equal(validateDraft({ decision: 'draft', title: '画面更新',
    claims: [{ text: '加载速度有所提升。', quote: '更快的加载速度' }], reason: 'source-backed' },
  { channel: 'ai', title: '更新', summary: '本次提供更快的加载速度。' }).decision, 'draft');
});

test('a generated claim must quote an exact source excerpt', () => {
  assert.throws(() => validateDraft({ decision: 'draft', title: '合作恐怖游戏',
    claims: [{ text: '支持六人合作。', quote: 'Supports six-player online multiplayer.' }], reason: 'test' }, candidate));
});

test('LLM prose cannot override Steam price or add historical-low claims', () => {
  assert.throws(() => validateDraft({ decision: 'draft', title: '合作恐怖游戏',
    claims: [{ text: '史低只要十元。', quote: 'online co-op horror game' }], reason: 'test' }, candidate));
});

test('Steam price, deadline, region and title are rendered from source data', () => {
  const draft = validateDraft({ decision: 'draft', title: '模型标题',
    claims: [{ text: '支持最多六人在线合作。', quote: 'online co-op horror game with up to 6 players' }], reason: 'test' }, candidate);
  const text = renderDraft({ ...candidate, id: '123', source: 'Steam', url: 'https://store.steampowered.com/app/123/?cc=cn',
    fetchedAt: '2026-11-05T01:00:00Z', facts: { region: 'CN', currency: 'CNY', finalMinor: 2275,
      initialMinor: 3500, discountPercent: 35, expiresAt: '2026-11-09T17:00:00Z' } }, draft);
  assert.ok(text.startsWith('Sample Game\n'));
  assert.ok(text.includes('中国区 ¥22.75（原价 ¥35.00，降价 35%）'));
  assert.ok(text.includes('2026-11-10 01:00'));
  assert.ok(!text.includes('模型标题'));
});
