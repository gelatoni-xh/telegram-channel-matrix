import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEmailCopy } from '../src/email-digest.js';

const items = [{ id: '2448570', title: '暴力摩托™：30 周年纪念版',
  summary: '游戏首次以数字版形式回归，包含重新取得授权的原声音乐。',
  claims: ['纪念版包含重新取得授权的原声音乐。'] }];
const channels = [{ channel: 'steam', emailItems: items }];

test('email copy accepts concise source-grounded prose and keeps item identity', () => {
  const result = validateEmailCopy({ items: [
    { id: '2448570', text: '纪念版以数字版形式回归，并收录重新取得授权的原声音乐。', quote: '游戏首次以数字版形式回归' },
  ] }, channels, items);
  assert.equal(result.items[0]!.id, '2448570');
});

test('email copy rejects unsupported quotes, invented Steam price facts, and omitted entries', () => {
  assert.throws(() => validateEmailCopy({ items: [
    { id: '2448570', text: '值得购买。', quote: '值得购买' },
  ] }, channels, items), /invalid_email_copy_item/);
  assert.throws(() => validateEmailCopy({ items: [
    { id: '2448570', text: '售价 ¥10。', quote: '重新取得授权的原声音乐' },
  ] }, channels, items), /email_copy_contains_steam_facts/);
  assert.throws(() => validateEmailCopy({ items: [] }, channels, items), /invalid_email_copy/);
});
