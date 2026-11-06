import { homedir } from 'node:os';
import { join } from 'node:path';
import { channels } from './config.js';
import { readBotToken } from './credentials.js';
import { LocalPublicationStore, publishOnce } from './publications.js';
import { createTransport, TelegramError, TelegramPublisher } from './telegram.js';

async function main(): Promise<void> {
  const [command, target = 'all', ...extra] = process.argv.slice(2);
  if (!['doctor', 'test-send'].includes(command ?? '') || extra.length
    || !['all', ...channels.map(channel => channel.key)].includes(target)) {
    throw new Error('用法：npm run doctor 或 npm run test-send -- [ai|steam|all]');
  }
  const connection = createTransport(await readBotToken());
  try {
    const publisher = new TelegramPublisher(connection.transport);
    const me = await publisher.identity();
    console.log(`Bot：@${me.username}`);
    const store = new LocalPublicationStore(join(homedir(), '.local/share/telegram-channel-matrix/receipts'));
    let failed = false;
    for (const channel of channels.filter(channel => target === 'all' || channel.key === target)) {
      try {
        const chatId = await publisher.checkChannel(channel, me.id);
        console.log(`${channel.title}：身份及发布权限通过`);
        if (command === 'test-send') {
          const result = await publishOnce(store, `smoke-v1-${channel.key}`, chatId, () => publisher.send(chatId,
            '🧪 频道发布测试\n\n这是一条测试消息，用于确认频道发布正常。正式内容即将上线。'));
          console.log(result.status === 'sent'
            ? `已发送：https://t.me/${channel.username.slice(1)}/${result.messageId}`
            : '已有测试发送记录，跳过重复发送；如之前状态不明，请先核对频道和本地记录。');
        }
      } catch (error) {
        failed = true;
        console.error(`${channel.title}：${error instanceof TelegramError ? error.message : '本地发送记录或运行异常；未自动重试。'}`);
      }
    }
    if (failed) process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

main().catch(error => {
  console.error(error instanceof TelegramError ? error.message : '运行失败，请检查命令、钥匙串配置和本地文件权限。');
  process.exitCode = 1;
});
