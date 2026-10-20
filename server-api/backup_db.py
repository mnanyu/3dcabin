#!/usr/bin/env python3
"""Create a consistent SQLite backup and keep daily/weekly copies."""
from __future__ import annotations

import gzip
import json
import os
import sqlite3
import sys
import time
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import app


def log(entry: dict) -> None:
    path = os.path.join(app.DB_DIR, "backup.log")
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def notify_failure(message: str) -> None:
    try:
        import urllib.request
        payload = json.dumps({
            "name": "林间小屋 · 备份失败",
            "message": message,
            "contact": "system",
            "page": "backup_db.py",
            "ip": "",
            "_subject": "林间小屋备份失败",
            "_template": "table",
            "_captcha": "false",
        }, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            app.FEEDBACK_RELAY_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Origin": app.FEEDBACK_SITE,
                "Referer": app.FEEDBACK_SITE + "/",
                "User-Agent": "ForestCabinBackup/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except Exception as exc:
        log({"time": int(time.time()), "status": "notify_failed", "error": str(exc)[:300]})


def main() -> int:
    started = time.time()
    backup_dir = os.path.join(app.DB_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    tmp = os.path.join(backup_dir, ".fishing-" + stamp + ".db")
    final = os.path.join(backup_dir, "fishing-" + stamp + ".db.gz")
    try:
        source = sqlite3.connect(app.DB_PATH)
        target = sqlite3.connect(tmp)
        source.backup(target)
        source.close()
        target.close()
        check = sqlite3.connect(tmp)
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
        check.close()
        if integrity != "ok":
            raise RuntimeError("integrity_check=" + str(integrity))
        with open(tmp, "rb") as raw, gzip.open(final, "wb", compresslevel=6) as compressed:
            while True:
                chunk = raw.read(1024 * 1024)
                if not chunk:
                    break
                compressed.write(chunk)
        os.remove(tmp)

        cutoff_daily = time.time() - 7 * 86400
        cutoff_weekly = time.time() - 28 * 86400
        for name in os.listdir(backup_dir):
            if not (name.startswith("fishing-") and name.endswith(".db.gz")):
                continue
            path = os.path.join(backup_dir, name)
            try:
                day = datetime.strptime(name[8:23], "%Y%m%d-%H%M%S")
            except ValueError:
                continue
            age = time.time() - day.timestamp()
            keep_weekly = day.weekday() == 6 and age <= cutoff_weekly
            if age > cutoff_daily and not keep_weekly:
                os.remove(path)

        log({
            "time": int(time.time()),
            "status": "ok",
            "file": os.path.basename(final),
            "bytes": os.path.getsize(final),
            "durationMs": int((time.time() - started) * 1000),
        })
        return 0
    except Exception as exc:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        log({
            "time": int(time.time()),
            "status": "failed",
            "error": str(exc)[:500],
            "durationMs": int((time.time() - started) * 1000),
        })
        notify_failure("备份失败：" + str(exc)[:500])
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
