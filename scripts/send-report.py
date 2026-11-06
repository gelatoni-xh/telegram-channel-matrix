#!/usr/bin/env python3
import json
import os
from pathlib import Path
import smtplib
import ssl
import sys
from email.message import EmailMessage

try:
    config = json.loads(Path(os.environ['MAIL_CONFIG_PATH']).read_text())
    report = json.loads(Path(sys.argv[1]).read_text())
    message = EmailMessage()
    message['From'] = config['from']
    message['To'] = config['to']
    message['Subject'] = f"[频道每日精选] {report['date']} · {report['status']}"
    message.set_content('频道运行结果（北京时间日期）\n\n' + json.dumps(report, ensure_ascii=False, indent=2))
    with smtplib.SMTP_SSL(config['host'], config['port'], context=ssl.create_default_context(), timeout=30) as client:
        client.login(config['username'], config['password'])
        client.send_message(message)
    print('运行报告邮件已提交 SMTP。')
except Exception:
    print('运行报告邮件发送失败；Telegram 状态不变。', file=sys.stderr)
    sys.exit(1)
