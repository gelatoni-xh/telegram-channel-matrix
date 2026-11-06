#!/usr/bin/env python3
"""Fallback for startup failure, timeout, OOM, or an interrupted task."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import time

root = Path(os.environ['DATA_DIRECTORY'])
started = float((root/'service-started-at').read_text())
latest = root/'latest-run-report.json'
if latest.exists():
    try:
        report = json.loads(latest.read_text())
        if datetime.fromisoformat(report['finishedAt'].replace('Z','+00:00')).timestamp() >= started and report.get('email') == 'submitted':
            raise SystemExit(0)
    except (ValueError, KeyError):
        pass
date = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
path = root / f'service-failure-{int(time.time())}.json'
path.write_text(json.dumps({'date':date,'status':'service_failed','startedAtEpoch':started,
    'message':'线上服务未正常完成或运行邮件未成功提交。请核对 systemd 日志及数据库发送回执；不要直接重发，消息可能已送达。'},ensure_ascii=False))
subprocess.run(['python3','scripts/send-report.py',str(path)],check=True)
