export interface Channel {
  key: string;
  title: string;
  username: string;
}

export const channels: readonly Channel[] = [
  { key: 'ai', title: 'AI产品雷达', username: '@ai_product_radar_cn' },
  { key: 'steam', title: 'Steam折扣情报局', username: '@steam_deals_radar_cn' },
];

// AI publishes three bounded windows; Steam remains one daily issue.
export const dailySelectionPolicy = {
  format: 'windowed-digest', collectionRunsPerDay: 3,
  maxItems: { ai: 8, steam: 5 }, minimumItems: 1, timeZone: 'Asia/Shanghai',
  aiTriggerTimes: ['08:20', '16:20', '23:20'], steamTriggerTime: '08:20',
} as const;
