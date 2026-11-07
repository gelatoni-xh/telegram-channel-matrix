import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { channels } from './config.js';
import { readBotToken } from './credentials.js';
import { dailyDigest, type DigestItem } from './daily-digest.js';
import { generateEmailCopy } from './email-digest.js';
import { generateDrafts, validateDraft, type Candidate } from './local-preview.js';
import { currentAiWindow, operatingDate, ProductionStore, windowBounds, type PublicationWindow } from './production-store.js';
import { createTransport, TelegramError, TelegramPublisher } from './telegram.js';

const execute = promisify(execFile);
const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, 'utf8'));

async function python(script: string, argument: string): Promise<void> {
  const result = await execute('python3', [join('scripts', script), argument], { timeout: 600_000, maxBuffer: 1024 * 1024 });
  if (result.stdout.trim()) console.log(result.stdout.trim());
}

async function main(): Promise<void> {
  const windowArg = process.argv[2] as PublicationWindow | undefined;
  const channelArg = process.argv[3];
  if (process.argv.length > 4 || (windowArg && !['morning','afternoon','evening','daily'].includes(windowArg))
    || (channelArg && !['ai','steam'].includes(channelArg)) || (channelArg && !windowArg)) throw new Error('invalid_window_or_channel');
  if (!process.env.DATABASE_URL || !process.env.DATA_DIRECTORY || !process.env.MAIL_CONFIG_PATH) throw new Error('production_config_missing');
  const date = operatingDate();
  const window: PublicationWindow = windowArg ?? currentAiWindow() ?? 'morning';
  if (window === 'daily' && channelArg !== 'steam') throw new Error('daily_window_is_steam_only');
  const runId = randomUUID();
  const store = new ProductionStore(process.env.DATABASE_URL);
  await store.connect();
  let transport: ReturnType<typeof createTransport> | undefined;
  let started = false;
  const directory = join(process.env.DATA_DIRECTORY, 'runs', `${date}-${runId}`);
  const report: any = { date, window, runId, startedAt: new Date().toISOString(), status: 'running', channels: [], sources: [] };
  try {
    if (!await store.lock()) { console.log('已有线上任务运行，本次退出。'); return; }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await store.db.query('INSERT INTO matrix_runs(id,operating_date,status) VALUES($1,$2,\'running\')', [runId,date]);
    started = true;
    transport = createTransport(await readBotToken());
    const publisher = new TelegramPublisher(transport.transport);
    report.channelSnapshots = await Promise.all(channels.map(async channel => {
      let memberCount: number | null = null;
      try { memberCount = await publisher.memberCount(channel.username); } catch { /* Analytics must not block publication. */ }
      return { channel: channel.key, memberCount, collectedAt: new Date().toISOString() };
    }));
    const active = [];
    for (const channel of channels) {
      if (channelArg && channel.key !== channelArg) continue;
      if (channel.key === 'ai' && window === 'daily') continue;
      if (channel.key === 'steam' && window !== 'morning' && window !== 'daily') continue;
      const publicationWindow = channel.key === 'steam' ? 'daily' : window;
      const status = await store.state(channel.key, date, publicationWindow);
      if (status && status !== 'failed') report.channels.push({ channel: channel.key, window: publicationWindow, status: `blocked_${status}` });
      else active.push(channel);
    }
    if (!active.length) {
      report.status = report.channels.some((c: any) => c.status !== 'blocked_sent') ? 'attention_required' : 'already_sent';
      return;
    }
    const sourceWindow = window === 'daily' ? undefined : windowBounds(window as Exclude<PublicationWindow,'daily'>, date);
    const collectionChannels = active.map(channel => channel.key);
    await execute('python3', [join('scripts','collect-preview.py'), directory], { timeout: 600_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, MATRIX_CHANNELS: collectionChannels.length === 1 ? collectionChannels[0] : undefined,
        ...(sourceWindow ? { MATRIX_WINDOW_START: sourceWindow.start, MATRIX_WINDOW_END: sourceWindow.end } : {}) } });
    const collected = await readJson(join(directory, 'candidates.json'));
    report.sources = collected.sources;
    await writeFile(join(directory, 'collected.json'), JSON.stringify(collected, null, 2));
    const filtered: Candidate[] = [];
    let duplicates = 0;
    const identities = new Set<string>();
    for (const candidate of collected.candidates as Candidate[]) {
      if (!active.some(channel => channel.key === candidate.channel)) continue;
      const key = `${candidate.channel}:${candidate.id}`;
      if (identities.has(key) || await store.seen(candidate)) { duplicates++; continue; }
      identities.add(key);
      filtered.push(candidate);
    }
    collected.candidates = filtered;
    report.duplicates = duplicates;
    report.candidates = filtered.length;
    await writeFile(join(directory, 'candidates.json'), JSON.stringify(collected, null, 2));
    await generateDrafts(directory, true);
    const generated = await readJson(join(directory, 'llm-results.json'));
    report.model = generated.model;
    report.promptHash = generated.promptHash;
    report.generation = generated.results.map((entry: any) => ({ id: entry.id,
      channel: filtered.find(candidate => candidate.id === entry.id)?.channel,
      status: entry.status, kind: entry.kind, reason: entry.reason }));
    const bot = await publisher.identity();
    for (const channel of active) {
      try {
        let candidates = filtered.filter(candidate => candidate.channel === channel.key
          && generated.results.some((result: any) => result.id === candidate.id && result.status === 'draft'));
        if (channel.key === 'steam' && candidates.length) {
          const path = join(directory, 'steam-preflight.json');
          await writeFile(path, JSON.stringify(candidates));
          await python('verify-steam.py', path);
          const preflight = await readJson(path);
          report.steamPreflightRejected = preflight.rejected;
          candidates = preflight.accepted;
        }
      const items: DigestItem[] = candidates.map(candidate => {
          const result = generated.results.find((entry: any) => entry.id === candidate.id && entry.status === 'draft');
          const draft = validateDraft(result.draft, candidate);
          return { id: candidate.id, title: candidate.channel === 'steam' ? candidate.title : draft.title,
            lines: draft.claims.map(claim => claim.text), source: candidate.source, url: candidate.url,
            publishedAt: candidate.publishedAt,
            offer: candidate.facts ? { ...candidate.facts, checkedAt: candidate.fetchedAt } : undefined };
        });
        const digest = dailyDigest(channel.key as 'ai'|'steam', date, items, true);
        if (!digest) {
          const sourceFailed = collected.sources.some((s: any) => s.status === 'failed' && (channel.key === 'steam' ? s.source === 'Steam' : s.source !== 'Steam'));
          const generationFailed = generated.results.some((r: any) => /failed/.test(r.status) && filtered.some(c => c.id === r.id && c.channel === channel.key));
          const checkFailed = channel.key === 'steam' && Boolean(report.steamPreflightRejected?.length);
          report.channels.push({ channel: channel.key, status: sourceFailed || generationFailed || checkFailed ? 'no_publication_errors' : 'no_content' });
          continue;
        }
        const chatId = await publisher.checkChannel(channel, bot.id);
        if (operatingDate() !== date) throw new Error('operating_date_changed');
        if (channel.key === 'steam' && candidates.some(c => Date.now() - Date.parse(c.fetchedAt) > 5 * 60_000)) throw new Error('stale_preflight');
        const selected = candidates.filter(candidate => digest.items.some(item => item.id === candidate.id));
        const publicationWindow = channel.key === 'steam' ? 'daily' : window;
        if (!await store.reserve(channel.key,date,publicationWindow,chatId,runId,digest,selected)) {
          report.channels.push({ channel: channel.key, window: publicationWindow, status: 'blocked_existing_record' }); continue;
        }
        let messageId: number;
        try {
          messageId = await publisher.sendDigest(chatId,digest.html);
        } catch (error) {
          await store.finish(channel.key,date,publicationWindow,error instanceof TelegramError && error.outcome === 'rejected' ? 'failed' : 'uncertain');
          throw error;
        }
        // A failed DB write after Telegram acceptance leaves 'sending' locked; never label it retryable.
        await store.finish(channel.key,date,publicationWindow,'sent',messageId);
        report.channels.push({ channel: channel.key, window: publicationWindow, status: 'sent', messageId, count: digest.items.length,
          url: `https://t.me/${channel.username.slice(1)}/${messageId}`,
          emailItems: digest.items.map(item => {
            const candidate = candidates.find(entry => entry.id === item.id)!;
            const result = generated.results.find((entry: any) => entry.id === item.id && entry.status === 'draft');
            return { id: item.id, title: item.title, source: item.source, url: item.url,
              summary: candidate.summary, claims: result.draft.claims.map((claim: any) => claim.text), offer: item.offer };
          }) });
      } catch {
        report.channels.push({ channel: channel.key, window: channel.key === 'steam' ? 'daily' : window, status: 'error_check_database_receipt' });
      }
    }
    const errors = report.sources.some((s: any) => s.status === 'failed')
      || report.channels.some((c: any) => /error|uncertain|sending/.test(c.status))
      || generated.results.some((r: any) => /failed/.test(r.status));
    report.status = errors ? 'completed_with_errors' : 'completed';
  } catch {
    report.status = 'failed';
    report.error = 'pipeline_failed_see_saved_stage_artifacts';
  } finally {
    if (started) {
      try { report.emailCopy = await generateEmailCopy(report); }
      catch { report.emailCopy = { status: 'unavailable', items: [] }; }
      report.finishedAt = new Date().toISOString();
      const path = join(directory,'run-report.json');
      await writeFile(path,JSON.stringify(report,null,2));
      try { await store.db.query('UPDATE matrix_runs SET status=$2,finished_at=now(),report=$3 WHERE id=$1', [runId,report.status,JSON.stringify(report)]); }
      catch { report.databaseReportFailed = true; }
      try { await python('send-report.py',path); report.email = 'submitted'; }
      catch { report.email = 'failed'; }
      await writeFile(path,JSON.stringify(report,null,2));
      await writeFile(join(process.env.DATA_DIRECTORY!, 'latest-run-report.json'),JSON.stringify(report,null,2));
      await store.db.query('UPDATE matrix_runs SET report=$2 WHERE id=$1', [runId,JSON.stringify(report)]).catch(() => {});
      console.log(JSON.stringify(report));
      if (/failed|errors|attention/.test(report.status) || report.email === 'failed' || report.databaseReportFailed) process.exitCode = 1;
    }
    await transport?.close();
    await store.close();
  }
}

main().catch(() => { console.error('线上任务未完成；请检查 systemd 和持久化运行记录。'); process.exitCode = 1; });
