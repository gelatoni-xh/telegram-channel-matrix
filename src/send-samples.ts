import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EnvHttpProxyAgent, fetch } from 'undici';
import { channels } from './config.js';
import { readBotToken } from './credentials.js';
import { createTransport, TelegramError, TelegramPublisher, type ChannelPost } from './telegram.js';
import { LocalPublicationStore, publishOnce } from './publications.js';
import { aiPost, steamPost } from './post-layout.js';
import { validateDraft } from './local-preview.js';

async function main(): Promise<void> {
  const directory = process.argv[2];
  if (!directory || process.argv.length !== 3) throw new Error('invalid_arguments');
  const { candidates } = JSON.parse(await readFile(join(directory, 'candidates.json'), 'utf8'));
  const { results } = JSON.parse(await readFile(join(directory, 'llm-results.json'), 'utf8'));
  const posts: { key: string; post: ChannelPost; verification?: object }[] = [];
  const ai = candidates.find((candidate: any) => candidate.id === 'https://openai.com/index/introducing-images-2-6');
  const game = candidates.find((candidate: any) => candidate.channel === 'steam' && candidate.id === '3241660');
  if (!ai || !game) throw new Error('missing_samples');
  const aiDraft = validateDraft(results.find((result: any) => result.id === ai.id && result.status === 'draft')?.draft, ai);
  const gameDraft = validateDraft(results.find((result: any) => result.id === game.id && result.status === 'draft')?.draft, game);
  posts.push({ key: 'ai', post: aiPost({ title: aiDraft.title, lines: aiDraft.claims.map(claim => claim.text),
    source: ai.source, publishedAt: ai.publishedAt, url: ai.url }) });

  const dispatcher = new EnvHttpProxyAgent({ connect: { timeout: 15_000 } });
  try {
    async function get(url: string): Promise<any> {
      const response = await fetch(url, { dispatcher, signal: AbortSignal.timeout(30_000), redirect: 'error' });
      if (!response.ok) throw new Error('source_unavailable');
      return response.json();
    }
    const featured = await get('https://store.steampowered.com/api/featuredcategories?cc=cn&l=schinese');
    const item = featured.specials.items.find((entry: any) => String(entry.id) === game.id);
    const details = (await get(`https://store.steampowered.com/api/appdetails?appids=${game.id}&cc=cn&l=schinese`))[game.id];
    const data = details?.data;
    const price = data?.price_overview;
    if (!item || details.success !== true || data.type !== 'game' || data.is_free !== false
      || data.name !== game.title || item.currency !== 'CNY' || price?.currency !== 'CNY'
      || item.final_price !== price.final || item.original_price !== price.initial
      || item.discount_percent !== price.discount_percent
      || data.short_description !== game.summary) throw new Error('source_changed_or_inconsistent');
    const checkedAt = new Date().toISOString();
    const expiresAt = new Date(item.discount_expiration * 1000).toISOString();
    posts.push({ key: 'steam', post: steamPost({ title: data.name,
      lines: gameDraft.claims.map(claim => claim.text), url: game.url, finalMinor: price.final,
      initialMinor: price.initial, discountPercent: price.discount_percent, expiresAt, checkedAt }),
      verification: { appId: game.id, region: 'CN', currency: price.currency, finalMinor: price.final,
        initialMinor: price.initial, discountPercent: price.discount_percent, expiresAt, checkedAt } });
  } finally {
    await dispatcher.close();
  }
  // Save exact payloads before publishing; do not call the model again for styling.
  await writeFile(join(directory, 'channel-samples-ui-v1.json'), JSON.stringify(posts, null, 2) + '\n');
  const connection = createTransport(await readBotToken());
  try {
    const publisher = new TelegramPublisher(connection.transport);
    const me = await publisher.identity();
    const store = new LocalPublicationStore(join(homedir(), '.local/share/telegram-channel-matrix/receipts'));
    for (const { key, post } of posts) {
      const channel = channels.find(channel => channel.key === key)!;
      try {
        const chatId = await publisher.checkChannel(channel, me.id);
        const result = await publishOnce(store, `sample-20261105-ui-v1-${key}`, chatId, () => publisher.sendPost(chatId, post));
        console.log(result.status === 'sent' ? `${channel.title}：https://t.me/${channel.username.slice(1)}/${result.messageId}（排版与按钮回执通过）`
          : `${channel.title}：已有发送记录，跳过；请核对频道及本地回执。`);
      } catch (error) {
        console.error(`${channel.title}：${error instanceof TelegramError ? error.message : '发送或回执保存失败；未自动重试。'}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await connection.close();
  }
}

main().catch(() => { console.error('样稿准备或核验失败；未输出敏感详情。'); process.exitCode = 1; });
