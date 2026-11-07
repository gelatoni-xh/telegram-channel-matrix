#!/usr/bin/env python3
import json
import os
from pathlib import Path
import smtplib
import ssl
import sys
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo


CHANNELS = {'ai': 'AI 产品雷达', 'steam': 'Steam 折扣情报局'}


def email_subject(report):
    parts = []
    for channel in report.get('channels', []):
        title = CHANNELS.get(channel.get('channel'), channel.get('channel', '未知频道'))
        if channel.get('status') == 'sent':
            parts.append(f"{title}发送 {channel.get('count', 0)} 条")
        elif channel.get('status') == 'no_content':
            parts.append(f'{title}本次无合格内容')
        elif channel.get('status') == 'blocked_sent':
            parts.append(f'{title}今日已发送')
        else:
            parts.append(f'{title}推送需检查')
    return '；'.join(parts) or f"频道推送状态 · {report['date']}"


def beijing_time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(ZoneInfo('Asia/Shanghai')).strftime('%m 月 %d 日 %H:%M')


def email_body(report):
    lines = [f"{report['date']} 本次频道推送已完成。"]
    copy = report.get('emailCopy') or {}

    sent = [channel for channel in report.get('channels', []) if channel.get('status') == 'sent']
    if sent:
        lines.extend(['', '本次概览'])
        for channel in report.get('channels', []):
            title = CHANNELS.get(channel.get('channel'), channel.get('channel', '未知频道'))
            if channel.get('status') == 'sent':
                lines.append(f"- {title}：发送 {channel.get('count', 0)} 条")
            elif channel.get('status') == 'no_content':
                lines.append(f'- {title}：本次无合格内容')
            elif channel.get('status') == 'blocked_sent':
                lines.append(f'- {title}：今日已发送，跳过重复发布')
            else:
                lines.append(f"- {title}：{channel.get('status', '状态未知')}")

    for channel in sent:
        key = channel.get('channel')
        lines.extend(['', CHANNELS.get(key, key)])
        llm_copy = {item['id']: item['text'] for item in copy.get('items', []) if isinstance(item, dict) and 'id' in item}
        for item in channel.get('emailItems', []):
            offer = item.get('offer')
            if offer:
                price = f"¥{offer['finalMinor'] / 100:.2f}（原价 ¥{offer['initialMinor'] / 100:.2f}，降价 {offer['discountPercent']}%）"
                deadline = beijing_time(offer['expiresAt'])
                lines.extend(['', item['title'], f"{price}，优惠截至 {deadline}（北京时间）。"])
            else:
                lines.extend(['', item['title']])
            text = llm_copy.get(item['id'])
            if not text:
                text = ' '.join(item.get('claims') or []) or item.get('summary', '')
            if text:
                lines.append(text)
            lines.append(f"原文：{item['url']}")
        lines.append(f"频道推送：{channel['url']}")

    no_content = [channel for channel in report.get('channels', []) if channel.get('status') == 'no_content']
    for channel in no_content:
        entries = [item for item in report.get('generation', [])
                   if item.get('channel') == channel.get('channel') and item.get('status') == 'skipped_before_llm']
        if entries:
            reasons = {}
            for entry in entries:
                reason = entry.get('reason')
                label = {
                    'openai_non_product_or_missing_category': '不符合当前产品栏目分类',
                    'missing_summary_or_unverified_community_publisher': '缺少可用摘要或发布者未核验',
                }.get(reason, '未通过内容筛选')
                reasons[label] = reasons.get(label, 0) + 1
            detail = '，'.join(f'{count} 条{label}' for label, count in reasons.items())
            lines.extend(['', f"{CHANNELS.get(channel.get('channel'), channel.get('channel'))}：本次 {len(entries)} 条候选未发布（{detail}），因此没有进入文案生成。"])

    failed_sources = [source for source in report.get('sources', []) if source.get('status') == 'failed']
    if failed_sources:
        lines.extend(['', '采集异常：' + '、'.join(source.get('source', '未知来源') for source in failed_sources)])
    failed_channels = [channel for channel in report.get('channels', []) if channel.get('status') not in ('sent', 'no_content')]
    if failed_channels:
        lines.extend(['', '频道处理需要检查：' + '、'.join(CHANNELS.get(channel.get('channel'), channel.get('channel', '未知频道')) for channel in failed_channels)])
    return '\n'.join(lines) + '\n'

def main():
    try:
        config = json.loads(Path(os.environ['MAIL_CONFIG_PATH']).read_text())
        report = json.loads(Path(sys.argv[1]).read_text())
        message = EmailMessage()
        message['From'] = config['from']
        message['To'] = config['to']
        message['Subject'] = email_subject(report)
        message.set_content(email_body(report))
        with smtplib.SMTP_SSL(config['host'], config['port'], context=ssl.create_default_context(), timeout=30) as client:
            client.login(config['username'], config['password'])
            client.send_message(message)
        print('运行报告邮件已提交 SMTP。')
    except Exception:
        print('运行报告邮件发送失败；Telegram 状态不变。', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
