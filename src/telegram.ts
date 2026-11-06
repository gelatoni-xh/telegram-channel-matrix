import { EnvHttpProxyAgent, fetch } from 'undici';
import type { Channel } from './config.js';

export type Transport = (method: string, parameters: Record<string, unknown>) => Promise<unknown>;

export interface ChannelPost {
  html: string;
  button: { text: string; url: string };
}

export class TelegramError extends Error {
  constructor(message: string, public readonly outcome: 'rejected' | 'uncertain') {
    super(message);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TelegramError('Telegram 返回的数据格式无效。', 'uncertain');
  }
  return value as Record<string, unknown>;
}

export function createTransport(token: string): { transport: Transport; close: () => Promise<void> } {
  const dispatcher = new EnvHttpProxyAgent({ connect: { timeout: 15_000 } });
  return {
    transport: async (method, parameters) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parameters),
          dispatcher,
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        });
        // Never expose network exceptions: their URL includes the bot token.
        return await response.json();
      } catch {
        throw new TelegramError('Telegram 网络请求失败或响应无法解析；未自动重试。', 'uncertain');
      }
    },
    close: () => dispatcher.close(),
  };
}

export class TelegramPublisher {
  constructor(private readonly transport: Transport) {}

  private async call(method: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    const payload = object(await this.transport(method, parameters));
    if (payload.ok !== true) {
      const code = typeof payload.error_code === 'number' ? payload.error_code : undefined;
      // Telegram explicitly rejected the request only when ok=false is present.
      const outcome = payload.ok === false && code !== undefined && code < 500 ? 'rejected' : 'uncertain';
      throw new TelegramError(`Telegram API ${method} 未成功${code ? `（${code}）` : ''}。`, outcome);
    }
    return object(payload.result);
  }

  async identity(): Promise<{ id: number; username: string }> {
    const me = await this.call('getMe', {});
    if (!Number.isSafeInteger(me.id) || typeof me.username !== 'string' || me.is_bot !== true) {
      throw new TelegramError('Bot 身份响应不完整。', 'uncertain');
    }
    return { id: me.id as number, username: me.username };
  }

  async checkChannel(channel: Channel, botId: number): Promise<number> {
    const chat = await this.call('getChat', { chat_id: channel.username });
    if (chat.type !== 'channel' || typeof chat.username !== 'string'
      || `@${chat.username}`.toLowerCase() !== channel.username.toLowerCase()
      || !Number.isSafeInteger(chat.id)) {
      throw new TelegramError('目标频道身份不匹配，停止发送。', 'rejected');
    }
    const member = await this.call('getChatMember', { chat_id: chat.id, user_id: botId });
    if (member.status !== 'administrator' || member.can_post_messages !== true) {
      throw new TelegramError('Bot 尚未取得目标频道的发布权限。', 'rejected');
    }
    return chat.id as number;
  }

  async memberCount(chatId: number | string): Promise<number> {
    const response = object(await this.transport('getChatMemberCount', { chat_id: chatId }));
    if (response.ok !== true) {
      const code = typeof response.error_code === 'number' ? response.error_code : undefined;
      throw new TelegramError(`Telegram API getChatMemberCount 未成功${code ? `（${code}）` : ''}。`,
        response.ok === false && code !== undefined && code < 500 ? 'rejected' : 'uncertain');
    }
    const result = response.result;
    if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0) {
      throw new TelegramError('频道订阅人数响应无效。', 'uncertain');
    }
    return result;
  }

  async send(chatId: number, text: string): Promise<number> {
    if (!text.trim() || text.length > 4096) {
      throw new TelegramError('消息为空或超过 Telegram 长度限制。', 'rejected');
    }
    const message = await this.call('sendMessage', {
      chat_id: chatId, text, link_preview_options: { is_disabled: true },
    });
    if (!Number.isSafeInteger(message.message_id) || object(message.chat).id !== chatId) {
      throw new TelegramError('发送响应缺少可靠的消息或频道标识。', 'uncertain');
    }
    return message.message_id as number;
  }

  async sendDigest(chatId: number, html: string): Promise<number> {
    if (!html.trim() || html.length > 3800) throw new TelegramError('精选格式无效。', 'rejected');
    const message = await this.call('sendMessage', {
      chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    });
    if (!Number.isSafeInteger(message.message_id) || (message.message_id as number) <= 0 || object(message.chat).id !== chatId) {
      throw new TelegramError('精选发送回执无法确认。', 'uncertain');
    }
    return message.message_id as number;
  }

  async sendPost(chatId: number, post: ChannelPost): Promise<number> {
    const url = new URL(post.button.url);
    if (!post.html.trim() || post.html.length > 4096 || url.protocol !== 'https:'
      || url.username || url.password || !post.button.text.trim() || post.button.text.length > 64) {
      throw new TelegramError('频道消息或按钮格式无效。', 'rejected');
    }
    const message = await this.call('sendMessage', {
      chat_id: chatId, text: post.html, parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[post.button]] },
    });
    if (!Number.isSafeInteger(message.message_id) || object(message.chat).id !== chatId) {
      throw new TelegramError('发送响应缺少可靠的消息或频道标识。', 'uncertain');
    }
    // The message may already exist: never resend just to repair presentation.
    const entities = message.entities;
    const rows = object(message.reply_markup).inline_keyboard;
    if (!Array.isArray(entities) || !entities.some(entity => object(entity).type === 'bold')
      || !Array.isArray(rows) || !Array.isArray(rows[0])
      || object(rows[0][0]).url !== post.button.url || object(rows[0][0]).text !== post.button.text) {
      throw new TelegramError('消息可能已发送，但排版或按钮回执不完整；请核对频道，未自动重发。', 'uncertain');
    }
    return message.message_id as number;
  }
}
