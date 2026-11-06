import pg from 'pg';
import { createHash } from 'node:crypto';
import type { Candidate } from './local-preview.js';

export function operatingDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(now);
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
    const version = await this.db.query('SELECT version FROM matrix_schema_version WHERE version=1');
    if (!version.rowCount) throw new Error('schema_not_ready');
  }
  async lock(): Promise<boolean> {
    return (await this.db.query('SELECT pg_try_advisory_lock(783521906) AS locked')).rows[0].locked;
  }
  async state(channel: string, date: string): Promise<string | undefined> {
    return (await this.db.query('SELECT status FROM matrix_publications WHERE channel=$1 AND operating_date=$2 AND kind=\'daily_digest\'', [channel,date])).rows[0]?.status;
  }
  async seen(candidate: Candidate): Promise<boolean> {
    const result = await this.db.query(`SELECT 1 FROM matrix_publication_items i JOIN matrix_publications p USING(channel,operating_date,kind)
      WHERE i.channel=$1 AND i.fingerprint=$2 AND p.status IN ('sent','sending','uncertain') LIMIT 1`, [candidate.channel, fingerprint(candidate)]);
    return Boolean(result.rowCount);
  }
  async reserve(channel: string, date: string, chatId: number, runId: string, payload: unknown, candidates: Candidate[]): Promise<boolean> {
    await this.db.query('BEGIN');
    try {
      const result = await this.db.query(`INSERT INTO matrix_publications(channel,operating_date,chat_id,status,run_id,payload)
        VALUES($1,$2,$3,'sending',$4,$5) ON CONFLICT(channel,operating_date,kind) DO UPDATE
        SET status='sending',run_id=EXCLUDED.run_id,payload=EXCLUDED.payload,updated_at=now()
        WHERE matrix_publications.status='failed' RETURNING channel`, [channel,date,chatId,runId,JSON.stringify(payload)]);
      if (!result.rowCount) { await this.db.query('ROLLBACK'); return false; }
      await this.db.query('DELETE FROM matrix_publication_items WHERE channel=$1 AND operating_date=$2', [channel,date]);
      for (const [index,candidate] of candidates.entries()) {
        await this.db.query(`INSERT INTO matrix_publication_items(channel,operating_date,fingerprint,position,candidate)
          VALUES($1,$2,$3,$4,$5)`, [channel,date,fingerprint(candidate),index,JSON.stringify(candidate)]);
      }
      await this.db.query('COMMIT');
      return true;
    } catch (error) { await this.db.query('ROLLBACK'); throw error; }
  }
  async finish(channel: string, date: string, status: 'sent'|'failed'|'uncertain', messageId?: number): Promise<void> {
    const result = await this.db.query(`UPDATE matrix_publications SET status=$3,message_id=$4,
      sent_at=CASE WHEN $3='sent' THEN now() ELSE NULL END,updated_at=now()
      WHERE channel=$1 AND operating_date=$2 AND status='sending' RETURNING channel`, [channel,date,status,messageId ?? null]);
    if (result.rowCount !== 1) throw new Error('receipt_not_saved');
  }
  async close(): Promise<void> { await this.db.end(); }
}
