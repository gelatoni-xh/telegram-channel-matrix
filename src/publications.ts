import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { TelegramError } from './telegram.js';

export interface Receipt {
  key: string;
  chatId: number;
  status: 'sending' | 'sent' | 'failed' | 'uncertain';
  updatedAt: string;
  messageId?: number;
}

export interface PublicationStore {
  reserve(key: string, chatId: number): Promise<boolean>;
  finish(receipt: Receipt): Promise<void>;
}

// Local smoke-test storage only. Production business publications will use PostgreSQL.
export class LocalPublicationStore implements PublicationStore {
  constructor(private readonly directory: string) {}

  private path(key: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('无效的发布记录标识。');
    return join(this.directory, `${key}.json`);
  }

  async reserve(key: string, chatId: number): Promise<boolean> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await open(this.path(key), 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw new Error('无法创建本地发送记录，停止发送。');
    }
    try {
      await handle.writeFile(JSON.stringify({ key, chatId, status: 'sending', updatedAt: new Date().toISOString() }));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  }

  async finish(receipt: Receipt): Promise<void> {
    const path = this.path(receipt.key);
    const temporary = `${path}.${process.pid}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(receipt, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  }

  async read(key: string): Promise<Receipt> {
    return JSON.parse(await readFile(this.path(key), 'utf8')) as Receipt;
  }
}

export async function publishOnce(
  store: PublicationStore, key: string, chatId: number, send: () => Promise<number>,
): Promise<{ status: 'sent'; messageId: number } | { status: 'already-recorded' }> {
  if (!await store.reserve(key, chatId)) return { status: 'already-recorded' };
  let messageId: number;
  try {
    messageId = await send();
  } catch (error) {
    await store.finish({ key, chatId, status: error instanceof TelegramError && error.outcome === 'rejected'
      ? 'failed' : 'uncertain', updatedAt: new Date().toISOString() });
    throw error;
  }
  await store.finish({ key, chatId, status: 'sent', messageId, updatedAt: new Date().toISOString() });
  return { status: 'sent', messageId };
}
