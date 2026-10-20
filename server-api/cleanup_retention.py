#!/usr/bin/env python3
"""Apply tiered retention from a daily systemd timer, with an execution log."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app


def log(entry: dict) -> None:
    path = os.path.join(app.DB_DIR, "cleanup.log")
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def notify_failure(message: str) -> None:
    try:
        payload = json.dumps({
            "name": "林间小屋 · 清理失败",
            "message": message,
            "contact": "system",
            "page": "cleanup_retention.py",
            "ip": "",
            "_subject": "林间小屋清理失败",
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
                "User-Agent": "ForestCabinCleanup/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except Exception as exc:
        log({"time": int(time.time()), "status": "notify_failed", "error": str(exc)[:300]})


def counts(conn) -> dict:
    return {
        "users": int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]),
        "catches": int(conn.execute("SELECT COUNT(*) FROM catches").fetchone()[0]),
        "ip_geo": int(conn.execute("SELECT COUNT(*) FROM ip_geo").fetchone()[0]),
        "feedback": int(conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]),
    }


def main() -> int:
    started = time.time()
    try:
        app.init_db()
        conn = app.connect()
        try:
            before = counts(conn)
            app.cleanup(conn, force=True)
            after = counts(conn)
        finally:
            conn.close()
        log({
            "time": int(time.time()),
            "status": "ok",
            "before": before,
            "after": after,
            "durationMs": int((time.time() - started) * 1000),
        })
        return 0
    except Exception as exc:
        log({
            "time": int(time.time()),
            "status": "failed",
            "error": str(exc)[:500],
            "durationMs": int((time.time() - started) * 1000),
        })
        notify_failure("保留清理失败：" + str(exc)[:500])
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
