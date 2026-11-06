import type { ChannelPost } from './telegram.js';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function beijingTime(value: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function aiPost(input: { title: string; lines: string[]; source: string; publishedAt: string; url: string }): ChannelPost {
  return {
    html: [`⚡ <b>${escapeHtml(input.title)}</b>`, '', ...input.lines.map(line => `• ${escapeHtml(line)}`), '',
      `<i>${escapeHtml(input.source)} · ${beijingTime(input.publishedAt)}（北京时间）</i>`, '<i>样稿</i>'].join('\n'),
    button: { text: '阅读官方原文 ↗', url: input.url },
  };
}

export function steamPost(input: {
  title: string; lines: string[]; url: string; finalMinor: number; initialMinor: number;
  discountPercent: number; expiresAt: string; checkedAt: string;
}): ChannelPost {
  if (![input.finalMinor, input.initialMinor, input.discountPercent].every(Number.isSafeInteger)
    || input.finalMinor <= 0 || input.finalMinor >= input.initialMinor
    || input.discountPercent <= 0 || input.discountPercent > 100
    || Math.abs((1 - input.finalMinor / input.initialMinor) * 100 - input.discountPercent) > 1
    || Date.parse(input.expiresAt) <= Date.parse(input.checkedAt)
    || !Number.isFinite(Date.parse(input.checkedAt)) || !Number.isFinite(Date.parse(input.expiresAt))) {
    throw new Error('价格或截止时间不满足样稿发布条件。');
  }
  return {
    html: [`🎮 <b>${escapeHtml(input.title)}</b>`, '',
      `<b>¥${(input.finalMinor / 100).toFixed(2)}</b>  <s>¥${(input.initialMinor / 100).toFixed(2)}</s>  ·  降价 ${input.discountPercent}%`, '',
      ...input.lines.map(escapeHtml), '', `⏳ ${beijingTime(input.expiresAt)} 截止（北京时间）`,
      '📍 Steam 中国区 · CNY', '', `<i>样稿 · 价格核验 ${beijingTime(input.checkedAt)}（北京时间）</i>`,
      '<i>价格及活动以商店页面为准</i>'].join('\n'),
    button: { text: '前往 Steam 查看优惠 ↗', url: input.url },
  };
}
