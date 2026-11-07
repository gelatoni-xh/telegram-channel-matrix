import { dailySelectionPolicy } from './config.js';
import { beijingTime, escapeHtml, steamPost } from './post-layout.js';

export interface DigestItem {
  id: string; title: string; lines: string[]; source: string; url: string; publishedAt?: string;
  offer?: { finalMinor: number; initialMinor: number; discountPercent: number; expiresAt: string; checkedAt: string };
}

export interface DailyDigest {
  html: string;
  items: DigestItem[];
  omittedIds: string[];
}

export function dailyDigest(channel: 'ai' | 'steam', date: string, candidates: DigestItem[], production = false): DailyDigest | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid_issue_date');
  const seen = new Set<string>();
  const unique = candidates.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)));
  const limit = dailySelectionPolicy.maxItems[channel];
  const items = unique.slice(0, limit);
  const omittedIds = unique.slice(limit).map(item => item.id);
  function render(): string {
    const heading = channel === 'ai' ? '⚡ AI产品雷达 · 每日精选' : '🎮 Steam折扣情报局 · 每日精选';
    const blocks = items.map((item, index) => {
      const url = new URL(item.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_source_url');
      const lines = [`<b>${index + 1}. ${escapeHtml(item.title)}</b>`];
      if (channel === 'steam') {
        if (!item.offer) throw new Error('missing_offer');
        // Reuse the existing deterministic price/deadline validation.
        steamPost({ title: item.title, lines: [], url: item.url, ...item.offer });
        const offer = item.offer;
        lines.push(`<b>¥${(offer.finalMinor / 100).toFixed(2)}</b>  <s>¥${(offer.initialMinor / 100).toFixed(2)}</s>  ·  降价 ${offer.discountPercent}%`);
      }
      // Preserve complete source-backed sentences; do not ask the model to rewrite facts for layout.
      lines.push(...item.lines.slice(0, 2).map(escapeHtml));
      if (channel === 'steam') lines.push(`⏳ ${beijingTime(item.offer!.expiresAt)} 截止（北京时间）`);
      const sourceDate = item.publishedAt ? ` · ${beijingTime(item.publishedAt)}（北京时间）` : '';
      lines.push(`<a href="${escapeHtml(item.url)}">${channel === 'steam' ? '查看商店 ↗' : '阅读原文 ↗'}</a> · ${escapeHtml(item.source)}${sourceDate}`);
      return lines.join('\n');
    });
    const footer = channel === 'steam'
      ? `Steam 中国区 / CNY；价格核验 ${items[0]?.offer ? beijingTime(items[0].offer.checkedAt) : ''}（北京时间），以商店页面为准`
      : production ? '' : '样稿 · 未发送';
    const content = [`<b>${heading}</b>`, `${date} · 本期 ${items.length} 条`, '', blocks.join('\n\n')];
    if (footer) content.push('', `<i>${footer}</i>`);
    return content.join('\n');
  }
  while (items.length) {
    const html = render();
    // Conservative raw-HTML bound, keeping the issue in one Telegram message.
    if (html.length <= 3800) return { html, items, omittedIds };
    omittedIds.unshift(items.pop()!.id);
  }
  return null;
}
