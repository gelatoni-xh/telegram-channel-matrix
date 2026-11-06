import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ProductionStore, operatingDate, fingerprint } from '../src/production-store.js';
import type { Candidate } from '../src/local-preview.js';
import { TelegramError, TelegramPublisher } from '../src/telegram.js';

test('operating date uses Beijing calendar boundary regardless of host timezone', () => {
  assert.equal(operatingDate(new Date('2026-11-05T15:59:59Z')), '2026-11-05');
  assert.equal(operatingDate(new Date('2026-11-05T16:00:00Z')), '2026-11-06');
});

test('digest sender requires positive message ID and matching Telegram channel', async () => {
  const publisher = new TelegramPublisher(async (_, parameters) => {
    assert.equal(parameters.parse_mode, 'HTML');
    assert.equal(parameters.reply_markup, undefined);
    return { ok: true, result: { message_id: 9, chat: { id: -1002 } } };
  });
  await assert.rejects(publisher.sendDigest(-1001, '<b>日报</b>'), e => e instanceof TelegramError && e.outcome === 'uncertain');
});

const candidate: Candidate = { id: '42', channel: 'steam', title: 'Game', summary: 'summary', source: 'Steam',
  url: 'https://store.steampowered.com/app/42/', fetchedAt: '2026-11-05T01:00:00Z',
  facts: { region: 'CN', currency: 'CNY', initialMinor: 1000, finalMinor: 500, discountPercent: 50, expiresAt: '2026-11-10T00:00:00Z' } };

test('Steam event identity includes offer end and price, not fetch timestamp', () => {
  assert.equal(fingerprint(candidate), fingerprint({ ...candidate, fetchedAt: '2026-11-06T01:00:00Z' }));
  assert.notEqual(fingerprint(candidate), fingerprint({ ...candidate, facts: { ...candidate.facts!, finalMinor: 400 } }));
});

test('real Postgres serializes runs, deduplicates dates and preserves uncertain send locks',
  { skip: !process.env.DATABASE_TEST_URL }, async () => {
    const setup = new pg.Client({ connectionString: process.env.DATABASE_TEST_URL });
    await setup.connect();
    await setup.query(await readFile('migrations/001_initial.sql', 'utf8'));
    const a = new ProductionStore(process.env.DATABASE_TEST_URL!);
    const b = new ProductionStore(process.env.DATABASE_TEST_URL!);
    await a.connect(); await b.connect();
    const runId = randomUUID();
    try {
      assert.equal(await a.lock(), true);
      assert.equal(await b.lock(), false);
      await setup.query("INSERT INTO matrix_runs(id,operating_date,status) VALUES($1,'2026-11-05','running')", [runId]);
      const outcomes = await Promise.all([a.reserve('steam','2026-11-05',-1001,runId,{},[candidate]), b.reserve('steam','2026-11-05',-1001,runId,{},[candidate])]);
      assert.equal(outcomes.filter(Boolean).length, 1);
      await a.finish('steam','2026-11-05','uncertain');
      assert.equal(await a.reserve('steam','2026-11-05',-1001,runId,{},[candidate]), false);
      assert.equal(await a.seen(candidate), true);
      await a.reserve('ai','2026-11-05',-1002,runId,{},[]);
      await a.finish('ai','2026-11-05','failed');
      assert.equal(await b.reserve('ai','2026-11-05',-1002,runId,{},[]), true);
      await b.finish('ai','2026-11-05','sent',123);
      assert.equal(await a.reserve('ai','2026-11-05',-1002,runId,{},[]), false);
      await assert.rejects(a.finish('ai','2026-11-05','failed'));
      assert.equal(await a.state('ai','2026-11-05'), 'sent');
      assert.equal(await a.reserve('ai','2026-11-06',-1002,runId,{},[]), true);
      await setup.query("DELETE FROM matrix_publication_items WHERE operating_date='2026-11-05'");
      await setup.query('DELETE FROM matrix_publications WHERE run_id=$1', [runId]);
      await setup.query('DELETE FROM matrix_runs WHERE id=$1', [runId]);
    } finally { await a.close(); await b.close(); await setup.end(); }
});
