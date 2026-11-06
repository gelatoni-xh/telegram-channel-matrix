import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function readBotToken(): Promise<string> {
  let token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token && process.platform === 'darwin') {
    try {
      const result = await execute('/usr/bin/security', [
        'find-generic-password', '-s', 'codex.telegram-channel-matrix', '-a', 'bot-token', '-w',
      ], { timeout: 15_000, maxBuffer: 8192 });
      token = result.stdout.trim();
    } catch {
      throw new Error('无法从 macOS 钥匙串读取频道 Bot Token。');
    }
  }
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('缺少有效的频道 Bot Token。');
  }
  return token;
}
