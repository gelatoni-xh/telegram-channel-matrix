import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export interface LlmConfig {
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  api: 'responses';
}

export async function readLlmConfig(): Promise<LlmConfig> {
  const config = JSON.parse(await readFile(process.env.LLM_CONFIG_PATH || join(homedir(), '.config/telegram-channel-matrix/llm.json'), 'utf8'));
  if (typeof config.model !== 'string' || !config.model.trim()
    || typeof config.reasoningEffort !== 'string' || !config.reasoningEffort.trim()
    || typeof config.baseUrl !== 'string' || config.api !== 'responses') {
    throw new Error('LLM 配置不完整。');
  }
  const url = new URL(config.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('LLM 接口地址无效。');
  }
  return { model: config.model, reasoningEffort: config.reasoningEffort, baseUrl: config.baseUrl, api: config.api };
}

export async function readLlmApiKey(): Promise<string> {
  const environmentKey = process.env.LLM_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const result = await execute('/usr/bin/security', [
    'find-generic-password', '-s', 'codex.telegram-channel-matrix', '-a', 'llm-api-key', '-w',
  ], { timeout: 15_000, maxBuffer: 8192 });
  const key = result.stdout.trim();
  if (!key) throw new Error('缺少 LLM 密钥。');
  return key;
}
