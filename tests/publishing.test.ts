import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { channels } from '../src/config.js';
import { LocalPublicationStore, publishOnce } from '../src/publications.js';
import { TelegramError, TelegramPublisher } from '../src/telegram.js';

test('channel identity mismatch prevents the permissions check and sending', async () => {
  const calls: string[] = [];
  const publisher = new TelegramPublisher(async method => {
    calls.push(method);
    return { ok: true, result: { id: -100123, username: 'wrong_channel', type: 'channel' } };
  });
  await assert.rejects(publisher.checkChannel(channels[0]!, 123), /身份不匹配/);
  assert.deepEqual(calls, ['getChat']);
});

test('administrator without post permission is rejected', async () => {
  const publisher = new TelegramPublisher(async method => ({ ok: true, result: method === 'getChat'
    ? { id: -100123, username: 'ai_product_radar_cn', type: 'channel' }
    : { status: 'administrator', can_post_messages: false } }));
  await assert.rejects(publisher.checkChannel(channels[0]!, 123), /发布权限/);
});

test('plain-text publishing preserves text and verifies returned channel', async () => {
  const text = '测试 < & **普通字符**';
  const publisher = new TelegramPublisher(async (method, params) => {
    assert.equal(method, 'sendMessage');
    assert.equal(params.text, text);
    assert.equal(params.parse_mode, undefined);
    return { ok: true, result: { message_id: 42, chat: { id: -100123 } } };
  });
  assert.equal(await publisher.send(-100123, text), 42);
});

test('unreliable send response is uncertain, never treated as success', async () => {
  const publisher = new TelegramPublisher(async () => ({ ok: true, result: { message_id: 42, chat: { id: -1 } } }));
  await assert.rejects(publisher.send(-100123, '测试'), error => error instanceof TelegramError && error.outcome === 'uncertain');
});

test('parallel attempts and subsequent reruns send only once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'channel-send-test-'));
  try {
    const store = new LocalPublicationStore(directory);
    let sends = 0;
    const send = async () => { sends++; return 12; };
    const results = await Promise.all([
      publishOnce(store, 'example', -100123, send),
      publishOnce(store, 'example', -100123, send),
    ]);
    assert.equal(sends, 1);
    assert.equal(results.filter(r => r.status === 'sent').length, 1);
    await publishOnce(store, 'example', -100123, send);
    assert.equal(sends, 1);
    assert.equal((await store.read('example')).messageId, 12);
  } finally { await rm(directory, { recursive: true }); }
});

test('ambiguous network failure persists uncertain and prevents rerun', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'channel-uncertain-test-'));
  try {
    const store = new LocalPublicationStore(directory);
    let sends = 0;
    const send = async (): Promise<number> => { sends++; throw new TelegramError('timeout', 'uncertain'); };
    await assert.rejects(publishOnce(store, 'example', -100123, send));
    assert.equal((await store.read('example')).status, 'uncertain');
    assert.equal((await publishOnce(store, 'example', -100123, send)).status, 'already-recorded');
    assert.equal(sends, 1);
  } finally { await rm(directory, { recursive: true }); }
});

test('explicit Telegram rejection is persisted as failed without automatic retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'channel-rejection-test-'));
  try {
    const store = new LocalPublicationStore(directory);
    const publisher = new TelegramPublisher(async () => ({ ok: false, error_code: 403, description: 'secret detail' }));
    await assert.rejects(publishOnce(store, 'example', -100123, () => publisher.send(-100123, '测试')),
      error => error instanceof TelegramError && error.outcome === 'rejected' && !error.message.includes('secret detail'));
    assert.equal((await store.read('example')).status, 'failed');
  } finally { await rm(directory, { recursive: true }); }
});
