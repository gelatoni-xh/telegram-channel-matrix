export interface Channel {
  key: string;
  title: string;
  username: string;
}

export const channels: readonly Channel[] = [
  { key: 'ai', title: 'AI产品雷达', username: '@ai_product_radar_cn' },
  { key: 'steam', title: 'Steam折扣情报局', username: '@steam_deals_radar_cn' },
];

// A daily issue is the publishing unit; candidates remain individually traceable.
export const dailySelectionPolicy = {
  format: 'daily-digest', collectionRunsPerDay: 1, issuesPerChannelPerDay: 1,
  maxItems: 5, minimumItems: 1, timeZone: 'Asia/Shanghai',
  triggerTime: '09:00',
} as const;
