import pg from 'pg';
import { createHash } from 'node:crypto';
import type { Candidate } from './local-preview.js';

export function operatingDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(now);
}

export type AiWindow = 'morning' | 'afternoon' | 'evening';
export type PublicationWindow = AiWindow | 'daily';

export function windowBounds(window: AiWindow, date: string): { start: string; end: string } {
  const previous = new Date(`${date}T00:00:00+08:00`);
  if (window === 'morning') previous.setUTCDate(previous.getUTCDate() - 1);
  const startTime = window === 'morning' ? '23:20:00' : window === 'afternoon' ? '08:20:00' : '16:20:00';
  const endTime = window === 'morning' ? '08:20:00' : window === 'afternoon' ? '16:20:00' : '23:20:00';
  const startDate = window === 'morning' ? operatingDate(previous) : date;
  return {
    start: new Date(`${startDate}T${startTime}+08:00`).toISOString(),
    end: new Date(`${date}T${endTime}+08:00`).toISOString(),
  };
}

export function currentAiWindow(now = new Date()): AiWindow | undefined {
  const minute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).replace(':', ''));
  if (minute < 820) return undefined;
  if (minute < 1620) return 'morning';
  if (minute < 2320) return 'afternoon';
  return 'evening';
}

export function fingerprint(candidate: Candidate): string {
  // Same Steam promotion at the same price is one event across calendar days.
  const identity = candidate.channel === 'steam'
    ? [candidate.id, candidate.facts?.finalMinor, candidate.facts?.expiresAt]
    : [candidate.url.replace(/\/$/, '')];
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export class ProductionStore {
  readonly db: pg.Client;
  constructor(url: string) { this.db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000, statement_timeout: 20_000 }); }
  async connect(): Promise<void> {
    await this.db.connect();
    // A dropped lock-owning connection must terminate the worker before it can publish.
    this.db.on('error', () => { console.error('数据库连接中断，停止发布。'); process.exit(1); });
    const version = await this.db.query('SELECT version FROM matrix_schema_version WHERE version=2');
    if (!version.rowCount) throw new Error('schema_not_ready');
  }
  async lock(): Promise<boolean> {
    return (await this.db.query('SELECT pg_try_advisory_lock(783521906) AS locked')).rows[0].locked;
  }
  async state(channel: string, date: string, window: PublicationWindow): Promise<string | undefined> {
    const result = channel === 'steam'
      ? await this.db.query('SELECT status FROM matrix_publications WHERE channel=$1 AND operating_date=$2 AND kind=\'daily_digest\'', [channel,date])
      : await this.db.query('SELECT status FROM matrix_publications WHERE channel=$1 AND operating_date=$2 AND window_id=$3 AND kind=\'daily_digest\'', [channel,date,window]);
    return result.rows[0]?.status;
  }
  async seen(candidate: Candidate): Promise<boolean> {
    const result = await this.db.query(`SELECT 1 FROM matrix_publication_items i JOIN matrix_publications p USING(channel,operating_date,window_id,kind)
      WHERE i.channel=$1 AND i.fingerprint=$2 AND p.status IN ('sent','sending','uncertain') LIMIT 1`, [candidate.channel, fingerprint(candidate)]);
    return Boolean(result.rowCount);
  }
  async reserve(channel: string, date: string, window: PublicationWindow, chatId: number, runId: string, payload: unknown, candidates: Candidate[]): Promise<boolean> {
    await this.db.query('BEGIN');
    try {
      const result = await this.db.query(`INSERT INTO matrix_publications(channel,operating_date,window_id,chat_id,status,run_id,payload)
        VALUES($1,$2,$3,$4,'sending',$5,$6) ON CONFLICT(channel,operating_date,window_id,kind) DO UPDATE
        SET status='sending',run_id=EXCLUDED.run_id,payload=EXCLUDED.payload,updated_at=now()
        WHERE matrix_publications.status='failed' RETURNING channel`, [channel,date,channel === 'steam' ? 'daily' : window,chatId,runId,JSON.stringify(payload)]);
      if (!result.rowCount) { await this.db.query('ROLLBACK'); return false; }
      await this.db.query('DELETE FROM matrix_publication_items WHERE channel=$1 AND operating_date=$2 AND window_id=$3', [channel,date,channel === 'steam' ? 'daily' : window]);
      for (const [index,candidate] of candidates.entries()) {
        await this.db.query(`INSERT INTO matrix_publication_items(channel,operating_date,window_id,fingerprint,position,candidate)
          VALUES($1,$2,$3,$4,$5,$6)`, [channel,date,channel === 'steam' ? 'daily' : window,fingerprint(candidate),index,JSON.stringify(candidate)]);
      }
      await this.db.query('COMMIT');
      return true;
    } catch (error) { await this.db.query('ROLLBACK'); throw error; }
  }
  async finish(channel: string, date: string, window: PublicationWindow, status: 'sent'|'failed'|'uncertain', messageId?: number): Promise<void> {
    const result = await this.db.query(`UPDATE matrix_publications SET status=$4,message_id=$5,
      sent_at=CASE WHEN $4='sent' THEN now() ELSE NULL END,updated_at=now()
      WHERE channel=$1 AND operating_date=$2 AND window_id=$3 AND status='sending' RETURNING channel`, [channel,date,channel === 'steam' ? 'daily' : window,status,messageId ?? null]);
    if (result.rowCount !== 1) throw new Error('receipt_not_saved');
  }
  async close(): Promise<void> { await this.db.end(); }
}
