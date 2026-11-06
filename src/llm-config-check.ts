import { readLlmApiKey, readLlmConfig } from './llm-config.js';

try {
  const config = await readLlmConfig();
  await readLlmApiKey();
  console.log(`LLM 配置读取通过：${config.model} / ${config.reasoningEffort} / ${config.api}`);
  console.log('项目密钥读取通过；未发起模型请求，未设置备用入口。');
} catch {
  console.error('LLM 配置或密钥读取失败；未输出敏感详情。');
  process.exitCode = 1;
}
