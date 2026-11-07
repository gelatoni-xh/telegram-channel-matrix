#!/usr/bin/env python3
"""Bounded RSS/Steam source adapter shared by preview and daily worker."""
import concurrent.futures
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import html
import json
import os
from pathlib import Path
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

NOW = datetime.now(timezone.utc)
CN = timezone(timedelta(hours=8))
START = (datetime.fromisoformat(os.environ['MATRIX_WINDOW_START'].replace('Z', '+00:00'))
         if os.environ.get('MATRIX_WINDOW_START')
         else (NOW.astimezone(CN) - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0))
END = datetime.fromisoformat(os.environ['MATRIX_WINDOW_END'].replace('Z', '+00:00')) if os.environ.get('MATRIX_WINDOW_END') else NOW
PRODUCTION = os.environ.get('MATRIX_PRODUCTION') == '1'
CHANNELS = os.environ.get('MATRIX_CHANNELS')
AI_ONLY = CHANNELS == 'ai'
STEAM_ONLY = CHANNELS == 'steam'
DEST = Path(sys.argv[1])
DEST.mkdir(parents=True, exist_ok=True)


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 TelegramChannelMatrix/0.1'})
    with urllib.request.urlopen(request, timeout=35) as response:
        data = response.read(4_000_001)
        if len(data) > 4_000_000:
            raise ValueError('response too large')
        return data


def plain(text):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]*>', ' ', text or ''))).strip()[:1800]


def rss(pair):
    name, url = pair
    root = ET.fromstring(fetch(url))
    result = []
    items = root.findall('.//item') or root.findall('.//{*}entry')
    for item in items:
        try:
            published_text = (item.findtext('pubDate') or item.findtext('{*}published')
                              or item.findtext('{*}updated'))
            try:
                published = parsedate_to_datetime(published_text)
            except (TypeError, ValueError):
                published = datetime.fromisoformat(published_text.replace('Z', '+00:00'))
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            link = item.findtext('link') or ''
            if not link:
                link_node = item.find('{*}link')
                link = link_node.attrib.get('href', '') if link_node is not None else ''
            if not START <= published <= END or not link.startswith('https://'):
                continue
            summary = (item.findtext('description') or item.findtext('{*}summary')
                       or item.findtext('{*}content') or item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded'))
            result.append({'id': link, 'channel': 'ai', 'source': name,
                           'title': plain(item.findtext('title')), 'url': link,
                           'publishedAt': published.isoformat(), 'fetchedAt': NOW.isoformat(),
                           'categories': [plain(category.text) for category in item.findall('category') if category.text],
                           'summary': plain(summary)})
        except (ValueError, TypeError, AttributeError):
            continue
    return sorted(result, key=lambda x: x['publishedAt'], reverse=True)


def steam():
    data = json.loads(fetch('https://store.steampowered.com/api/featuredcategories?cc=cn&l=schinese'))
    featured = data['specials']['items']
    result, skipped = [], []
    # Trial-only threshold and sample size, not a confirmed product policy.
    items = sorted(featured, key=lambda x: x.get('discount_percent', 0), reverse=True)
    for item in items[:20]:
        if len(result) >= (5 if PRODUCTION else 3):
            break
        if item.get('currency') != 'CNY' or item.get('discount_percent', 0) < 30:
            continue
        appid = item['id']
        expiry = item.get('discount_expiration')
        if not expiry or expiry < NOW.timestamp() + 12 * 3600:
            skipped.append({'id': appid, 'reason': 'missing deadline or less than 12h remaining'})
            continue
        details = json.loads(fetch(f'https://store.steampowered.com/api/appdetails?appids={appid}&cc=cn&l=schinese'))[str(appid)]
        detail = details.get('data', {})
        price = detail.get('price_overview', {})
        if (details.get('success') is not True or detail.get('type') != 'game'
            or detail.get('is_free') is not False or price.get('currency') != 'CNY'
            or price.get('final') != item.get('final_price')
            or price.get('initial') != item.get('original_price')
            or price.get('discount_percent') != item.get('discount_percent')
            or not isinstance(price.get('final'), int) or price['final'] <= 0):
            skipped.append({'id': appid, 'reason': 'type or region/price verification failed'})
            continue
        result.append({'id': str(appid), 'channel': 'steam', 'source': 'Steam 中国区商店',
                       'title': detail['name'], 'url': f'https://store.steampowered.com/app/{appid}/?cc=cn',
                       'fetchedAt': NOW.isoformat(), 'summary': plain(detail.get('short_description')),
                       'facts': {'region': 'CN', 'currency': 'CNY', 'finalMinor': price['final'],
                                 'initialMinor': price['initial'], 'discountPercent': price['discount_percent'],
                                 'expiresAt': datetime.fromtimestamp(expiry, timezone.utc).isoformat()}})
    return result, {'featuredCount': len(featured), 'skipped': skipped,
                    'coverage': 'Featured specials only; not all Steam discounts. Deadline from featured listing; appdetails verifies type and price.'}


def main():
    sources = [('OpenAI News', 'https://openai.com/news/rss.xml'),
               ('Google AI Blog', 'https://blog.google/technology/ai/rss/'),
               ('Hugging Face Blog', 'https://huggingface.co/blog/feed.xml'),
               ('GitHub Changelog', 'https://github.blog/changelog/feed/'),
               ('Cloudflare AI', 'https://blog.cloudflare.com/tag/ai/rss/'),
               ('Mistral News', 'https://mistral.ai/news/rss'),
               ('AWS Machine Learning Blog', 'https://aws.amazon.com/blogs/machine-learning/feed/')]
    candidates, statuses = [], []
    if not STEAM_ONLY:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            tasks = [(name, pool.submit(rss, (name, url))) for name, url in sources]
            for name, task in tasks:
                try:
                    items = task.result()
                    candidates.extend(items[:8])
                    statuses.append({'source': name, 'status': 'ok', 'inWindow': len(items)})
                except Exception as error:
                    statuses.append({'source': name, 'status': 'failed', 'errorType': type(error).__name__})
    if not AI_ONLY:
        try:
            items, stats = steam()
            candidates.extend(items)
            statuses.append({'source': 'Steam', 'status': 'ok', 'sampleCount': len(items), **stats})
        except Exception as error:
            statuses.append({'source': 'Steam', 'status': 'failed', 'errorType': type(error).__name__})
    report = {'mode': 'production' if PRODUCTION else 'local-preview-only', 'fetchedAt': NOW.isoformat(),
              'trialWindowStart': START.isoformat(), 'trialWindowEnd': END.isoformat(), 'timeZone': 'Asia/Shanghai',
              'policyVersion': 'daily-v1' if PRODUCTION else 'preview-v1',
              'policy': 'Previous Beijing calendar day through fetch time; AI max 8 per source; Steam featured specials only, max 5 production / 3 preview, discount >=30%, expiry >=12h.',
              'sources': statuses, 'candidates': candidates}
    (DEST / 'candidates.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'candidateCount': len(candidates), 'sources': statuses}, ensure_ascii=False))


if __name__ == '__main__':
    main()
