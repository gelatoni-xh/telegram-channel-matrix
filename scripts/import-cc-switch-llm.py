#!/usr/bin/env python3
"""Copy the named CC Switch Codex provider without exposing its API key."""
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys

WRITER = r'''
import Foundation
import Security
let value = FileHandle.standardInput.readDataToEndOfFile()
guard !value.isEmpty else { exit(1) }
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "codex.telegram-channel-matrix",
    kSecAttrAccount as String: "llm-api-key"
]
var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
if status == errSecItemNotFound {
    var item = query
    item[kSecValueData as String] = value
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    status = SecItemAdd(item as CFDictionary, nil)
}
guard status == errSecSuccess else { exit(1) }
'''


def field(text, name):
    # Only the simple quoted values used by this provider are accepted.
    match = re.search(r'^\s*' + re.escape(name) + r'\s*=\s*("[^"\n]*")\s*$', text, re.M)
    if not match:
        raise ValueError('Provider configuration is incomplete')
    return json.loads(match.group(1))


def main():
    database = Path.home() / '.cc-switch/cc-switch.db'
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        rows = connection.execute(
            "SELECT settings_config FROM providers WHERE app_type = 'codex' AND lower(name) = 'gpt pro'"
        ).fetchall()
    if len(rows) != 1:
        raise ValueError('Expected exactly one gpt pro Codex provider')
    settings = json.loads(rows[0][0])
    text = settings['config']
    root = text.split('[', 1)[0]
    provider = field(root, 'model_provider')
    sections = re.split(r'^\s*\[([^\n]+)\]\s*$', text, flags=re.M)
    provider_section = None
    for i in range(1, len(sections), 2):
        if sections[i] == 'model_providers.' + provider:
            provider_section = sections[i + 1]
    if provider_section is None:
        raise ValueError('Missing provider section')
    config = {
        'source': 'cc-switch:gpt pro',
        'model': field(root, 'model'),
        'reasoningEffort': field(root, 'model_reasoning_effort'),
        'baseUrl': field(provider_section, 'base_url'),
        'api': field(provider_section, 'wire_api'),
    }
    key = settings['auth']['OPENAI_API_KEY'].strip()
    if not key or config['api'] != 'responses' or not config['baseUrl'].startswith('https://'):
        raise ValueError('Unsupported provider configuration')
    subprocess.run(['/usr/bin/swift', '-e', WRITER], input=key.encode(),
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    folder = Path.home() / '.config/telegram-channel-matrix'
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = folder / 'llm.json.tmp'
    descriptor = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(config, output, ensure_ascii=False, indent=2)
        output.write('\n')
    temporary.replace(folder / 'llm.json')
    print('已导入 gpt pro 配置；密钥已保存到项目钥匙串。未设置备用入口。')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('导入失败，请检查 CC Switch 配置及钥匙串访问权限；未输出敏感详情。', file=sys.stderr)
        sys.exit(1)
