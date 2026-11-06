import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EnvHttpProxyAgent, fetch } from 'undici';
import { readLlmApiKey, readLlmConfig } from './llm-config.js';

export interface Candidate {
  id: string; channel: 'ai' | 'steam'; title: string; summary: string;
  source: string; url: string; publishedAt?: string; fetchedAt: string;
  categories?: string[];
  facts?: { region: string; currency: string; initialMinor: number; finalMinor: number; discountPercent: number; expiresAt: string };
}
interface Draft { decision: 'draft' | 'skip'; title: string; claims: { text: string; quote: string }[]; reason: string }

export function preflightSkipReason(candidate: Candidate): string | undefined {
  // OpenAI's official feed labels product announcements independently of customer stories/research.
  // Fail closed if this source removes or changes its category metadata.
  if (candidate.channel === 'ai' && candidate.source === 'OpenAI News'
    && !candidate.categories?.some(category => category.trim().toLowerCase() === 'product')) {
    return 'openai_non_product_or_missing_category';
  }
  if (!candidate.summary || (candidate.source === 'Hugging Face Blog'
    && new URL(candidate.url).pathname.split('/').filter(Boolean).length > 2)) {
    return 'missing_summary_or_unverified_community_publisher';
  }
  return undefined;
}
const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['draft', 'skip'] }, title: { type: 'string' },
    claims: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { text: { type: 'string' }, quote: { type: 'string' } }, required: ['text', 'quote'] } },
    reason: { type: 'string' },
  }, required: ['decision', 'title', 'claims', 'reason'],
};

export function validateDraft(value: unknown, candidate: Pick<Candidate, 'title' | 'summary' | 'channel'>): Draft {
  const draft = value as Draft;
  if (!draft || !['draft', 'skip'].includes(draft.decision) || typeof draft.title !== 'string'
    || (draft.decision === 'draft' && !draft.title.trim()) || draft.title.length > 60 || /[\r\n*]/.test(draft.title)
    || typeof draft.reason !== 'string' || !Array.isArray(draft.claims) || draft.claims.length > 3
    || (draft.decision === 'draft' && draft.claims.length === 0)
    || (draft.decision === 'skip' && draft.claims.length !== 0)) throw new Error('invalid_draft');
  for (const claim of draft.claims) {
    if (typeof claim.text !== 'string' || !claim.text.trim() || claim.text.length > 140
      || /[\r\n*]/.test(claim.text) || typeof claim.quote !== 'string' || claim.quote.trim().length < 4
      || ![candidate.title, candidate.summary].some(source => source.includes(claim.quote))) throw new Error('invalid_evidence');
    if (candidate.channel === 'steam' && /[¥￥%]|元|折扣|史低|免费|截止|原价|现价/.test(claim.text)) throw new Error('price_in_prose');
  }
  return draft;
}

export function renderDraft(candidate: Candidate, draft: Draft): string {
  const lines = [candidate.channel === 'steam' ? candidate.title : draft.title, '', ...draft.claims.map(claim => claim.text)];
  if (candidate.channel === 'steam') {
    const facts = candidate.facts;
    if (!facts || facts.region !== 'CN' || facts.currency !== 'CNY') throw new Error('missing_verified_price');
    lines.push('', `中国区 ¥${(facts.finalMinor / 100).toFixed(2)}（原价 ¥${(facts.initialMinor / 100).toFixed(2)}，降价 ${facts.discountPercent}%）`,
      `截止：${time(facts.expiresAt)}（北京时间）`, `价格采集：${time(candidate.fetchedAt)}（北京时间）；以商店结算页为准。`);
  } else {
    lines.push('', `来源：${candidate.source}｜${time(candidate.publishedAt!)}（北京时间）`);
  }
  lines.push(candidate.url);
  return lines.join('\n');
}

function time(value: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export async function generateDrafts(directory: string, production = false): Promise<void> {
  if (!directory) throw new Error('missing_output_directory');
  const report = JSON.parse(await readFile(join(directory, 'candidates.json'), 'utf8'));
  const candidates = report.candidates as Candidate[];
  const prompt = await readFile(join(process.cwd(), 'prompts', production ? 'daily-v1.txt' : 'local-preview-v1.txt'), 'utf8');
  const config = await readLlmConfig();
  const apiKey = await readLlmApiKey();
  const dispatcher = new EnvHttpProxyAgent({ connect: { timeout: 15_000 } });
  const results: object[] = [];
  const posts: string[] = [];
  try {
    for (const [index, candidate] of candidates.entries()) {
      const skipReason = preflightSkipReason(candidate);
      if (skipReason) {
        results.push({ id: candidate.id, status: 'skipped_before_llm', reason: skipReason });
        console.log(`${index + 1}/${candidates.length}：跳过（${skipReason}）`);
        continue;
      }
      console.log(`${index + 1}/${candidates.length}：生成 ${candidate.title}`);
      let generatedDraft: unknown;
      try {
        const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/responses`, {
          method: 'POST', dispatcher, redirect: 'error', signal: AbortSignal.timeout(180_000),
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: config.model, reasoning: { effort: config.reasoningEffort },
            instructions: prompt, input: JSON.stringify({ channel: candidate.channel, title: candidate.title, summary: candidate.summary }),
            store: false, max_output_tokens: 4000,
            text: { format: { type: 'json_schema', name: 'channel_draft', strict: true, schema } } }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          results.push({ id: candidate.id, status: 'llm_failed', httpStatus: response.status });
          console.log(`模型请求失败：HTTP ${response.status}；未重试`);
          continue;
        }
        const payload = await response.json() as any;
        if (payload.status !== 'completed') throw new Error('incomplete_response');
        const text = (payload.output ?? []).filter((item: any) => item.type === 'message')
          .flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('');
        generatedDraft = JSON.parse(text);
        const draft = validateDraft(generatedDraft, candidate);
        results.push({ id: candidate.id, status: draft.decision, draft, responseId: payload.id,
          usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens,
            totalTokens: payload.usage?.total_tokens } });
        if (draft.decision === 'draft') posts.push(renderDraft(candidate, draft));
        console.log(`结果：${draft.decision}`);
      } catch (error) {
        const kind = error instanceof Error && ['invalid_draft', 'invalid_evidence', 'price_in_prose', 'incomplete_response'].includes(error.message)
          ? error.message : 'request_or_parse_failed';
        results.push({ id: candidate.id, status: 'generation_or_validation_failed', kind, generatedDraft });
        console.log('生成或校验失败；未重试，未发布。');
      }
      await writeFile(join(directory, 'llm-results.json'), JSON.stringify({ model: config.model,
        promptVersion: production ? 'daily-v1' : 'local-preview-v1', promptHash: createHash('sha256').update(prompt).digest('hex'),
        mode: production ? 'production-draft' : 'local-preview-not-approved-for-publication', results }, null, 2) + '\n', { mode: 0o600 });
    }
    await writeFile(join(directory, 'preview.md'), '# 本地频道样稿\n\n试跑产物，尚未发布；证据片段匹配不能替代语义事实核验。\n\n'
      + posts.map((post, i) => `## 样稿 ${i + 1}\n\n${post}`).join('\n\n') + '\n');
    // Also persist empty/pre-skipped-only runs for reliable no-content reporting.
    await writeFile(join(directory, 'llm-results.json'), JSON.stringify({ model: config.model,
      promptVersion: production ? 'daily-v1' : 'local-preview-v1',
      promptHash: createHash('sha256').update(prompt).digest('hex'), results }, null, 2) + '\n', { mode: 0o600 });
    console.log(`完成：${posts.length} 条合格草稿；本阶段没有发送。`);
  } finally {
    await dispatcher.close();
  }
}

// Allow the pure validator/renderer to be tested without invoking the network.
if (process.argv[1]?.endsWith('/local-preview.ts')) {
  generateDrafts(process.argv[2]!).catch(() => { console.error('本地试跑失败；未输出敏感错误详情。'); process.exitCode = 1; });
}
