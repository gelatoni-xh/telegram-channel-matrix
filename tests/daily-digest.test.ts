import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyDigest, type DigestItem } from '../src/daily-digest.js';

function item(id: string): DigestItem {
  return { id, title: `Update ${id}`, lines: ['Source-backed summary.'], source: 'Official', url: `https://example.com/${id}` };
}

test('an empty day produces no issue and a sparse day does not invent entries', () => {
  assert.equal(dailyDigest('ai', '2026-11-05', []), null);
  const digest = dailyDigest('ai', '2026-11-05', [item('one')])!;
  assert.equal(digest.items.length, 1);
  assert.ok(digest.html.includes('本期 1 条'));
});

test('an AI issue removes duplicates, keeps order, allows eight entries and preserves each link', () => {
  const digest = dailyDigest('ai', '2026-11-05', [item('1'), item('1'), ...['2', '3', '4', '5', '6', '7', '8', '9'].map(item)])!;
  assert.deepEqual(digest.items.map(entry => entry.id), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(digest.omittedIds, ['9']);
  assert.ok(digest.html.includes('href="https://example.com/8"'));
  assert.ok(!digest.html.includes('href="https://example.com/9"'));
});

test('a Steam daily issue remains limited to five entries', () => {
  const games = ['1','2','3','4','5','6'].map(id => ({ ...item(id), offer: {
    finalMinor: 500, initialMinor: 1000, discountPercent: 50,
    expiresAt: '2026-11-10T00:00:00Z', checkedAt: '2026-11-05T00:00:00Z',
  } }));
  const digest = dailyDigest('steam', '2026-11-05', games)!;
  assert.equal(digest.items.length, 5);
  assert.deepEqual(digest.omittedIds, ['6']);
});

test('long issues drop entire entries without cutting source links or HTML', () => {
  const digest = dailyDigest('ai', '2026-11-05', ['1', '2', '3', '4', '5'].map(id => ({
    ...item(id), title: '<unsafe>', lines: ['long '.repeat(180)],
  })))!;
  assert.ok(digest.html.length <= 3800);
  assert.ok(digest.omittedIds.length > 0);
  assert.ok(digest.html.includes('&lt;unsafe&gt;'));
  assert.ok(digest.html.endsWith('</i>'));
  assert.equal((digest.html.match(/<a /g) ?? []).length, digest.items.length);
});

test('a Steam issue cannot include an expired offer', () => {
  assert.throws(() => dailyDigest('steam', '2026-11-05', [{ ...item('game'), offer: {
    finalMinor: 2275, initialMinor: 3500, discountPercent: 35,
    expiresAt: '2026-11-04T00:00:00Z', checkedAt: '2026-11-05T00:00:00Z',
  } }]));
});
