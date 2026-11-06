import assert from 'node:assert/strict';
import test from 'node:test';
import { aiPost, steamPost } from '../src/post-layout.js';
import { TelegramError, TelegramPublisher } from '../src/telegram.js';

test('source text cannot introduce HTML formatting or links', () => {
  const post = aiPost({ title: '<script> & headline', lines: ['<a href="https://wrong.test">Click</a>'],
    source: 'A & B', publishedAt: '2026-11-04T00:00:00Z', url: 'https://openai.com/' });
  assert.ok(post.html.includes('&lt;script&gt; &amp; headline'));
  assert.ok(!post.html.includes('<a href='));
});

test('expired or inconsistent Steam prices cannot render an offer', () => {
  const input = { title: 'Game', lines: [], url: 'https://store.steampowered.com/',
    finalMinor: 2275, initialMinor: 3500, discountPercent: 35,
    checkedAt: '2026-11-05T00:00:00Z', expiresAt: '2026-11-04T00:00:00Z' };
  assert.throws(() => steamPost(input));
  assert.throws(() => steamPost({ ...input, expiresAt: '2026-11-09T00:00:00Z', discountPercent: 80 }));
});

test('formatted posting uses native HTML and an exact external navigation button', async () => {
  const post = aiPost({ title: 'Images update', lines: ['New features.'], source: 'OpenAI',
    publishedAt: '2026-11-04T00:00:00Z', url: 'https://openai.com/news/' });
  const publisher = new TelegramPublisher(async (method, parameters) => {
    assert.equal(method, 'sendMessage');
    assert.equal(parameters.parse_mode, 'HTML');
    assert.deepEqual(parameters.link_preview_options, { is_disabled: true });
    assert.deepEqual(parameters.reply_markup, { inline_keyboard: [[post.button]] });
    return { ok: true, result: { message_id: 43, chat: { id: -100123 },
      entities: [{ type: 'bold', offset: 2, length: 12 }], reply_markup: parameters.reply_markup } };
  });
  assert.equal(await publisher.sendPost(-100123, post), 43);
});

test('missing button in a send response is uncertain and must not trigger a resend', async () => {
  const publisher = new TelegramPublisher(async () => ({ ok: true, result: {
    message_id: 43, chat: { id: -100123 }, entities: [{ type: 'bold' }], reply_markup: { inline_keyboard: [] },
  } }));
  await assert.rejects(publisher.sendPost(-100123, { html: '<b>Title</b>', button: { text: 'Read', url: 'https://openai.com/' } }),
    error => error instanceof TelegramError && error.outcome === 'uncertain');
});
