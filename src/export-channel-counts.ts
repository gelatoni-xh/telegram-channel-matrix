import { channels } from './config.js';
import { readBotToken } from './credentials.js';
import { createTransport, TelegramPublisher } from './telegram.js';
import { operatingDate } from './production-store.js';

async function main(): Promise<void> {
  const connection = createTransport(await readBotToken());
  try {
    const publisher = new TelegramPublisher(connection.transport);
    const snapshots = await Promise.all(channels.map(async channel => {
      let memberCount: number | null = null;
      try { memberCount = await publisher.memberCount(channel.username); } catch { /* Keep a temporary API failure separate from zero. */ }
      return { key: channel.key, memberCount };
    }));
    console.log(JSON.stringify({ date: operatingDate(), collectedAt: new Date().toISOString(), channels: snapshots }));
  } finally {
    await connection.close();
  }
}

main().catch(() => { console.error('Channel subscriber snapshot failed.'); process.exitCode = 1; });
