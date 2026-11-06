#!/usr/bin/env python3
"""Recheck exactly the selected promotions just before assembling the issue."""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'TelegramChannelMatrix/0.1'}), timeout=35) as r:
        return json.load(r)

def main():
    path = Path(sys.argv[1])
    candidates = json.loads(path.read_text())
    now = datetime.now(timezone.utc)
    featured = get('https://store.steampowered.com/api/featuredcategories?cc=cn&l=schinese')['specials']['items']
    items = {str(item['id']): item for item in featured}
    accepted, rejected = [], []
    for candidate in candidates:
        try:
            item = items[candidate['id']]
            data = get(f"https://store.steampowered.com/api/appdetails?appids={candidate['id']}&cc=cn&l=schinese")[candidate['id']]
            detail = data['data']
            price = detail['price_overview']
            facts = candidate['facts']
            expiry = datetime.fromtimestamp(item['discount_expiration'], timezone.utc)
            if (data['success'] is not True or detail['type'] != 'game' or detail['is_free'] is not False
                or price['currency'] != 'CNY' or item.get('currency') != 'CNY'
                or price['final'] != facts['finalMinor'] or price['initial'] != facts['initialMinor']
                or price['discount_percent'] != facts['discountPercent']
                or item['final_price'] != price['final'] or item['original_price'] != price['initial']
                or item['discount_percent'] != price['discount_percent']
                or expiry != datetime.fromisoformat(facts['expiresAt'])
                or (expiry - now).total_seconds() < 12 * 3600):
                raise ValueError('changed_or_expired')
            candidate['fetchedAt'] = now.isoformat()
            accepted.append(candidate)
        except Exception:
            rejected.append(candidate['id'])
    path.write_text(json.dumps({'checkedAt': now.isoformat(), 'accepted': accepted, 'rejected': rejected}, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Steam preflight failed; no unverified promotion will be sent.', file=sys.stderr)
        sys.exit(1)
