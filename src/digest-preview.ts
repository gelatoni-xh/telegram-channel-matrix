import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dailyDigest, type DigestItem } from './daily-digest.js';
import { validateDraft } from './local-preview.js';

async function main(): Promise<void> {
  const directory = process.argv[2];
  if (!directory || process.argv.length !== 3) throw new Error('invalid_arguments');
  const report = JSON.parse(await readFile(join(directory, 'candidates.json'), 'utf8'));
  const { results } = JSON.parse(await readFile(join(directory, 'llm-results.json'), 'utf8'));
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(new Date(report.fetchedAt));
  const digests = [];
  for (const channel of ['ai', 'steam'] as const) {
    const items: DigestItem[] = [];
    for (const result of results.filter((entry: any) => entry.status === 'draft')) {
      const candidate = report.candidates.find((entry: any) => entry.id === result.id && entry.channel === channel);
      if (!candidate) continue;
      const draft = validateDraft(result.draft, candidate);
      const offer = candidate.facts ? { ...candidate.facts, checkedAt: candidate.fetchedAt } : undefined;
      items.push({ id: candidate.id, title: channel === 'steam' ? candidate.title : draft.title,
        lines: draft.claims.map(claim => claim.text), source: candidate.source, url: candidate.url,
        publishedAt: candidate.publishedAt, offer });
    }
    const digest = dailyDigest(channel, date, items);
    if (digest) digests.push({ channel, ...digest });
  }
  await writeFile(join(directory, 'daily-digests.json'), JSON.stringify({ mode: 'local-preview-only', date, digests }, null, 2) + '\n');
  // Browser preview uses real HTML links, with a narrow column to check reading flow.
  // This approximates layout only; Telegram clients use their own fonts and spacing.
  const cards = digests.map(digest => `<article>${digest.html.replace(/\n/g, '<br>')}</article>`).join('\n');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>每日精选 · 本地排版预览</title><style>body{margin:0;padding:24px 16px;background:#e8eef2;color:#1c2933;font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:440px;margin:auto}header{font-size:13px;color:#52636d;margin-bottom:18px}article{background:white;border-radius:14px;padding:20px;margin-bottom:24px;overflow-wrap:anywhere;box-shadow:0 2px 8px #182b3910}a{color:#1684b6;text-decoration:none}i{color:#667984;font-size:12px}b{font-weight:650}s{color:#7a8893}</style><main><header>本地样稿 · 链接可点击 · 未发送<br>浏览器近似排版，实际以 Telegram 客户端为准。游戏价格为历史采集快照。</header>${cards}</main></html>`;
  await writeFile(join(directory, 'daily-digests.html'), html);
  console.log(`已生成 ${digests.length} 篇每日精选：${digests.map(digest => `${digest.channel} ${digest.items.length} 条`).join('，')}。未调用 LLM 或发送。`);
}

main().catch(() => { console.error('每日精选预览生成失败。'); process.exitCode = 1; });
