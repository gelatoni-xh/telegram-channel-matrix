import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EnvHttpProxyAgent, fetch } from 'undici';
import { readLlmApiKey, readLlmConfig } from './llm-config.js';

interface EmailItem {
  id: string; title: string; summary: string; claims: string[];
}

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { id: { type: 'string' }, text: { type: 'string' }, quote: { type: 'string' } },
      required: ['id', 'text', 'quote'] } },
  }, required: ['items'],
};

export async function generateEmailCopy(report: any): Promise<{ status: 'generated' | 'no_items'; items: { id: string; text: string }[] }> {
  const sourceItems: EmailItem[] = report.channels.flatMap((channel: any) => channel.emailItems ?? []);
  if (!sourceItems.length) return { status: 'no_items', items: [] };

  const config = await readLlmConfig();
  const apiKey = await readLlmApiKey();
  const instructions = await readFile(join(process.cwd(), 'prompts', 'email-digest-v1.txt'), 'utf8');
  const dispatcher = new EnvHttpProxyAgent({ connect: { timeout: 15_000 } });
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST', dispatcher, redirect: 'error', signal: AbortSignal.timeout(90_000),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model, reasoning: { effort: config.reasoningEffort }, instructions,
        input: JSON.stringify({ date: report.date, items: sourceItems }), store: false, max_output_tokens: 1800,
        text: { format: { type: 'json_schema', name: 'email_digest_copy', strict: true, schema } } }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('email_copy_request_failed');
    }
    const payload = await response.json() as any;
    if (payload.status !== 'completed') throw new Error('email_copy_incomplete');
    const output = (payload.output ?? []).filter((part: any) => part.type === 'message')
      .flatMap((part: any) => part.content ?? []).filter((part: any) => part.type === 'output_text')
      .map((part: any) => part.text).join('');
    const generated = validateEmailCopy(JSON.parse(output), report.channels, sourceItems);
    return { status: 'generated', ...generated };
  } finally {
    await dispatcher.close();
  }
}

export function validateEmailCopy(generated: any, channels: any[], sourceItems: EmailItem[]): { items: { id: string; text: string }[] } {
  if (!Array.isArray(generated?.items) || generated.items.length !== sourceItems.length) throw new Error('invalid_email_copy');
  const seen = new Set<string>();
  const items = generated.items.map((item: any) => {
    const source = sourceItems.find(entry => entry.id === item.id);
    if (!source || seen.has(item.id) || typeof item.text !== 'string' || !item.text.trim()
      || item.text.length > 180 || /[\r\n]/.test(item.text) || typeof item.quote !== 'string'
      || item.quote.trim().length < 4 || ![source.title, source.summary, ...source.claims].some(value => value.includes(item.quote))) {
      throw new Error('invalid_email_copy_item');
    }
    if (channels.find((channel: any) => channel.emailItems?.some((entry: any) => entry.id === item.id))?.channel === 'steam'
      && /[¥￥%]|元|折扣|史低|免费|截止|原价|现价/.test(item.text)) throw new Error('email_copy_contains_steam_facts');
    seen.add(item.id);
    return { id: item.id, text: item.text };
  });
  return { items };
}
