#!/usr/bin/env python3
"""Forest Cabin backpack API.

One anonymous server-side data record per browser (HttpOnly cookie),
with a rolling 30-day fish backpack. Only the Python standard library is used.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse
import urllib.request

HOST = "127.0.0.1"
PORT = 8765
WINDOW_SECONDS = 30 * 24 * 60 * 60
CATCH_RETENTION_SECONDS = 180 * 24 * 60 * 60
FISHING_TZ = timezone(timedelta(hours=8))
BASE_FISH_LIMITS = {
    "虹鳟": (24, 42),
    "鲫鱼": (13, 24),
    "溪哥": (9, 16),
    "鲤鱼": (32, 56),
    "山女鳟": (18, 30),
}
RARE_FISH_RULES = {
    "月影鳟": {"period": "夜", "min": 45, "max": 70},
    "晨雾鱼": {"period": "晨", "weather": "雾", "min": 22, "max": 38},
    "赤金鲤": {"period": "昏", "weather": "晴", "min": 40, "max": 65},
    "雨鳞鱼": {"weather": "雨", "min": 16, "max": 30},
}
RARE_FISH_LIMITS = {name: (rule["min"], rule["max"]) for name, rule in RARE_FISH_RULES.items()}
FISH_LIMITS = {**BASE_FISH_LIMITS, **RARE_FISH_LIMITS}
DAILY_SPECIES = list(BASE_FISH_LIMITS.keys())
CATCH_RATE_PER_MINUTE = 8
CATCH_RATE_PER_DAY = 120
NAMED_RETENTION_SECONDS = 90 * 24 * 60 * 60
ANON_RETENTION_SECONDS = 30 * 24 * 60 * 60
COOKIE_NAME = "cabin_uid"
COOKIE_MAX_AGE = 365 * 24 * 60 * 60
DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "fishing.db")
MAX_BODY = 4096
MAX_NAME = 12
UID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
EVENT_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f<>]")

ADMIN_COOKIE = "cabin_admin"
ADMIN_SESSION_SECONDS = 12 * 60 * 60
ADMIN_PBKDF2_ROUNDS = 210_000
ADMIN_SALT = os.environ.get("ADMIN_SALT", "")
ADMIN_HASH = os.environ.get("ADMIN_HASH", "")
GEO_CACHE_SECONDS = 7 * 24 * 60 * 60
GEO_FAIL_SECONDS = 60 * 60
GEO_RETENTION_SECONDS = 90 * 24 * 60 * 60
FEEDBACK_RETENTION_SECONDS = 180 * 24 * 60 * 60
AUDIT_RETENTION_SECONDS = 180 * 24 * 60 * 60
FEEDBACK_TO = os.environ.get("FEEDBACK_TO", "you@example.com")
FEEDBACK_RELAY_URL = "https://formsubmit.co/ajax/" + quote(FEEDBACK_TO, safe="@")
FEEDBACK_SITE = os.environ.get("FEEDBACK_SITE", "https://rmqiu.top")
FEEDBACK_RATE_SECONDS = 10 * 60
FEEDBACK_RATE_LIMIT = 3
_geo_inflight: set[str] = set()
_geo_lock = threading.Lock()
_feedback_times: dict[str, list[float]] = {}
_feedback_lock = threading.Lock()

_cleanup_lock = threading.Lock()
_last_cleanup = 0.0
_admin_sessions: dict[str, dict] = {}
_admin_lock = threading.Lock()
_admin_failures: dict[str, list[float]] = {}
_admin_failure_lock = threading.Lock()


def now_ts() -> int:
    return int(time.time())


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db() -> None:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = connect()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                uid TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL DEFAULT 0,
                last_ip TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS catches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                uid TEXT NOT NULL,
                species TEXT NOT NULL,
                length INTEGER NOT NULL,
                caught_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_catches_uid_time
                ON catches(uid, caught_at);
            CREATE INDEX IF NOT EXISTS idx_catches_time
                ON catches(caught_at);
            CREATE TABLE IF NOT EXISTS ip_geo (
                ip TEXT PRIMARY KEY,
                country TEXT NOT NULL DEFAULT '',
                region TEXT NOT NULL DEFAULT '',
                city TEXT NOT NULL DEFAULT '',
                isp TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL,
                contact TEXT NOT NULL DEFAULT '',
                page TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                email_status TEXT NOT NULL DEFAULT 'pending',
                email_error TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS admin_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                target TEXT NOT NULL DEFAULT '',
                ip TEXT NOT NULL DEFAULT '',
                detail TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS daily_quests (
                uid TEXT NOT NULL,
                quest_date TEXT NOT NULL,
                target_species TEXT NOT NULL,
                target_count INTEGER NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                completed INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                completed_at INTEGER,
                PRIMARY KEY(uid, quest_date)
            );
            CREATE TABLE IF NOT EXISTS daily_streaks (
                uid TEXT PRIMARY KEY,
                current_streak INTEGER NOT NULL DEFAULT 0,
                best_streak INTEGER NOT NULL DEFAULT 0,
                last_completed_date TEXT NOT NULL DEFAULT ''
            );
            """
        )
        columns = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "last_seen" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0")
        if "last_ip" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN last_ip TEXT NOT NULL DEFAULT ''")
        feedback_columns = [row[1] for row in conn.execute("PRAGMA table_info(feedback)").fetchall()]
        if "uid" not in feedback_columns:
            conn.execute("ALTER TABLE feedback ADD COLUMN uid TEXT NOT NULL DEFAULT ''")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name_unique "
            "ON users(name COLLATE NOCASE) WHERE name <> ''"
        )
        conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', '2026-10-20.2')"
        )
        conn.execute(
            "UPDATE meta SET value = '2026-10-20.2' WHERE key = 'schema_version' AND value <> '2026-10-20.2'"
        )
        conn.commit()
    finally:
        conn.close()


def cleanup(conn: sqlite3.Connection, force: bool = False) -> None:
    global _last_cleanup
    now = now_ts()
    if not force and now - _last_cleanup < 600:
        return
    with _cleanup_lock:
        if not force and now - _last_cleanup < 600:
            return
        catch_cutoff = now - CATCH_RETENTION_SECONDS
        named_cutoff = now - NAMED_RETENTION_SECONDS
        anon_cutoff = now - ANON_RETENTION_SECONDS
        conn.execute("DELETE FROM catches WHERE caught_at < ?", (catch_cutoff,))
        geo_cutoff = now - GEO_RETENTION_SECONDS
        feedback_cutoff = now - FEEDBACK_RETENTION_SECONDS
        audit_cutoff = now - AUDIT_RETENTION_SECONDS
        conn.execute("DELETE FROM ip_geo WHERE updated_at < ?", (geo_cutoff,))
        conn.execute("DELETE FROM feedback WHERE created_at < ?", (feedback_cutoff,))
        conn.execute("DELETE FROM admin_audit WHERE created_at < ?", (audit_cutoff,))
        conn.execute(
            """
            DELETE FROM users
            WHERE uid NOT IN (SELECT DISTINCT uid FROM catches)
              AND (
                (name <> '' AND COALESCE(NULLIF(last_seen, 0), updated_at) < ?)
                OR (name = '' AND COALESCE(NULLIF(last_seen, 0), updated_at) < ?)
              )
            """,
            (named_cutoff, anon_cutoff),
        )
        conn.execute("DELETE FROM daily_quests WHERE uid NOT IN (SELECT uid FROM users)")
        conn.execute("DELETE FROM daily_streaks WHERE uid NOT IN (SELECT uid FROM users)")
        conn.commit()
        _last_cleanup = now


def clean_text(value, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    value = CONTROL_RE.sub("", value).strip()
    return value[:limit]


def clean_feedback_text(value, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]", "", value)
    return value.strip()[:limit]


def normalize_ip(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return ""


def ensure_user(conn: sqlite3.Connection, uid: str, ip: str = "") -> None:
    now = now_ts()
    conn.execute(
        """
        INSERT OR IGNORE INTO users(uid, name, created_at, updated_at, last_seen, last_ip)
        VALUES(?, '', ?, ?, ?, ?)
        """,
        (uid, now, now, now, ip),
    )
    conn.execute(
        "UPDATE users SET last_seen = ?, last_ip = CASE WHEN ? <> '' THEN ? ELSE last_ip END WHERE uid = ?",
        (now, ip, ip, uid),
    )


def user_row(conn: sqlite3.Connection, uid: str):
    return conn.execute(
        "SELECT uid, name, created_at, last_seen, last_ip FROM users WHERE uid = ?",
        (uid,),
    ).fetchone()


def location_text(country: str, region: str, city: str) -> str:
    parts = []
    for value in (country, region, city):
        value = (value or "").strip()
        if value and value not in parts:
            parts.append(value)
    return " · ".join(parts)


def store_ip_geo(
    conn: sqlite3.Connection,
    ip: str,
    country: str,
    region: str,
    city: str,
    isp: str,
    status: str,
) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO ip_geo(ip, country, region, city, isp, status, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        """,
        (ip, country or "", region or "", city or "", isp or "", status, now_ts()),
    )
    conn.commit()


def fetch_ip_geo(ip: str) -> dict | None:
    api_url = (
        "http://ip-api.com/json/"
        + quote(ip, safe="")
        + "?fields=status,message,country,regionName,city,isp&lang=zh-CN"
    )
    try:
        request = urllib.request.Request(api_url, headers={"User-Agent": "ForestCabinAdmin/1.0"})
        with urllib.request.urlopen(request, timeout=4) as response:
            data = json.loads(response.read().decode("utf-8", "replace"))
        if data.get("status") == "success":
            return {
                "country": data.get("country", ""),
                "region": data.get("regionName", ""),
                "city": data.get("city", ""),
                "isp": data.get("isp", ""),
            }
    except Exception:
        pass

    # HTTPS fallback when the free ip-api endpoint is unavailable.
    try:
        info_url = "https://ipinfo.io/" + quote(ip, safe="") + "/json"
        request = urllib.request.Request(info_url, headers={"User-Agent": "ForestCabinAdmin/1.0"})
        with urllib.request.urlopen(request, timeout=4) as response:
            data = json.loads(response.read().decode("utf-8", "replace"))
        if data.get("city") or data.get("region") or data.get("country"):
            return {
                "country": data.get("country", ""),
                "region": data.get("region", ""),
                "city": data.get("city", ""),
                "isp": data.get("org", ""),
            }
    except Exception:
        pass
    return None


def resolve_ip_geo(ip: str) -> None:
    ip = normalize_ip(ip)
    if not ip:
        return
    now = now_ts()
    conn = connect()
    try:
        row = conn.execute(
            "SELECT status, updated_at FROM ip_geo WHERE ip = ?",
            (ip,),
        ).fetchone()
        if row:
            if row["status"] == "ok" and now - int(row["updated_at"]) < GEO_CACHE_SECONDS:
                return
            if row["status"] == "local":
                return
            if row["status"] == "fail" and now - int(row["updated_at"]) < GEO_FAIL_SECONDS:
                return

        try:
            address = ipaddress.ip_address(ip)
        except ValueError:
            return
        if not address.is_global:
            store_ip_geo(conn, ip, "", "", "本地/内网", "", "local")
            return

        data = fetch_ip_geo(ip)
        if data:
            store_ip_geo(
                conn,
                ip,
                data.get("country", ""),
                data.get("region", ""),
                data.get("city", ""),
                data.get("isp", ""),
                "ok",
            )
        elif row and row["status"] == "ok":
            conn.execute("UPDATE ip_geo SET updated_at = ? WHERE ip = ?", (now, ip))
            conn.commit()
        else:
            store_ip_geo(conn, ip, "", "", "", "", "fail")
    finally:
        conn.close()


def queue_ip_geo(ip: str) -> None:
    ip = normalize_ip(ip)
    if not ip:
        return
    with _geo_lock:
        if ip in _geo_inflight:
            return
        _geo_inflight.add(ip)
    threading.Thread(target=_geo_worker, args=(ip,), daemon=True).start()


def _geo_worker(ip: str) -> None:
    try:
        resolve_ip_geo(ip)
    finally:
        with _geo_lock:
            _geo_inflight.discard(ip)


def fishing_now() -> datetime:
    return datetime.now(FISHING_TZ)


def get_fishing_conditions(now: datetime | None = None) -> dict:
    moment = now or fishing_now()
    hour = moment.hour
    if 5 <= hour < 8:
        period = "晨"
    elif 8 <= hour < 17:
        period = "日"
    elif 17 <= hour < 20:
        period = "昏"
    else:
        period = "夜"
    weather = ("晴", "雨", "雾")[moment.date().toordinal() % 3]
    conditions = {"period": period, "weather": weather, "date": moment.date().isoformat()}
    conditions["rare"] = [
        name
        for name, rule in RARE_FISH_RULES.items()
        if ("period" not in rule or rule["period"] == period)
        and ("weather" not in rule or rule["weather"] == weather)
    ]
    return conditions


def species_allowed(species: str, conditions: dict) -> bool:
    if species in BASE_FISH_LIMITS:
        return True
    rule = RARE_FISH_RULES.get(species)
    if not rule:
        return False
    if "period" in rule and rule["period"] != conditions.get("period"):
        return False
    if "weather" in rule and rule["weather"] != conditions.get("weather"):
        return False
    return True


def ensure_daily_quest(conn: sqlite3.Connection, uid: str) -> sqlite3.Row:
    day = fishing_now().date().isoformat()
    row = conn.execute(
        "SELECT uid, quest_date, target_species, target_count, progress, completed FROM daily_quests WHERE uid = ? AND quest_date = ?",
        (uid, day),
    ).fetchone()
    if row:
        return row
    species = secrets.choice(DAILY_SPECIES)
    count = secrets.randbelow(3) + 1
    conn.execute(
        """
        INSERT OR IGNORE INTO daily_quests(uid, quest_date, target_species, target_count, progress, completed, created_at)
        VALUES(?, ?, ?, ?, 0, 0, ?)
        """,
        (uid, day, species, count, now_ts()),
    )
    conn.commit()
    return conn.execute(
        "SELECT uid, quest_date, target_species, target_count, progress, completed FROM daily_quests WHERE uid = ? AND quest_date = ?",
        (uid, day),
    ).fetchone()


def daily_payload(conn: sqlite3.Connection, uid: str) -> dict:
    row = ensure_daily_quest(conn, uid)
    today = fishing_now().date()
    yesterday = (today - timedelta(days=1)).isoformat()
    streak = conn.execute(
        "SELECT current_streak, best_streak, last_completed_date FROM daily_streaks WHERE uid = ?",
        (uid,),
    ).fetchone()
    current = 0
    best = 0
    if streak:
        best = int(streak["best_streak"] or 0)
        last = str(streak["last_completed_date"] or "")
        if last in (today.isoformat(), yesterday):
            current = int(streak["current_streak"] or 0)
    conditions = get_fishing_conditions()
    return {
        "date": today.isoformat(),
        "targetSpecies": row["target_species"],
        "targetCount": int(row["target_count"]),
        "progress": min(int(row["progress"]), int(row["target_count"])),
        "completed": bool(row["completed"]),
        "streak": current,
        "bestStreak": best,
        "conditions": conditions,
    }


def advance_daily_quest(conn: sqlite3.Connection, uid: str, species: str) -> None:
    row = ensure_daily_quest(conn, uid)
    if int(row["completed"]) or species != row["target_species"]:
        return
    progress = int(row["progress"]) + 1
    target = int(row["target_count"])
    if progress < target:
        conn.execute(
            "UPDATE daily_quests SET progress = ? WHERE uid = ? AND quest_date = ?",
            (progress, uid, row["quest_date"]),
        )
        return

    today = fishing_now().date()
    yesterday = (today - timedelta(days=1)).isoformat()
    conn.execute(
        "UPDATE daily_quests SET progress = ?, completed = 1, completed_at = ? WHERE uid = ? AND quest_date = ?",
        (target, now_ts(), uid, row["quest_date"]),
    )
    streak = conn.execute(
        "SELECT current_streak, best_streak, last_completed_date FROM daily_streaks WHERE uid = ?",
        (uid,),
    ).fetchone()
    if streak and streak["last_completed_date"] == yesterday:
        current = int(streak["current_streak"]) + 1
    elif streak and streak["last_completed_date"] == today.isoformat():
        current = int(streak["current_streak"])
    else:
        current = 1
    best = max(int(streak["best_streak"]) if streak else 0, current)
    conn.execute(
        """
        INSERT INTO daily_streaks(uid, current_streak, best_streak, last_completed_date)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(uid) DO UPDATE SET
          current_streak = excluded.current_streak,
          best_streak = excluded.best_streak,
          last_completed_date = excluded.last_completed_date
        """,
        (uid, current, best, today.isoformat()),
    )


def encyclopedia_payload(conn: sqlite3.Connection, uid: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT species, COUNT(*) AS count, MAX(length) AS best_length,
               MIN(caught_at) AS first_at, MAX(caught_at) AS last_at
        FROM catches WHERE uid = ? GROUP BY species
        """,
        (uid,),
    ).fetchall()
    found = {row["species"]: row for row in rows}
    result = []
    for name in FISH_LIMITS:
        row = found.get(name)
        result.append({
            "name": name,
            "rare": name in RARE_FISH_RULES,
            "caught": bool(row),
            "count": int(row["count"]) if row else 0,
            "bestLength": int(row["best_length"]) if row else 0,
            "firstCaughtAt": int(row["first_at"]) if row else None,
            "lastCaughtAt": int(row["last_at"]) if row else None,
        })
    return result


def personal_best_payload(conn: sqlite3.Connection, uid: str) -> dict | None:
    row = conn.execute(
        "SELECT species, length, caught_at FROM catches WHERE uid = ? ORDER BY length DESC, caught_at DESC LIMIT 1",
        (uid,),
    ).fetchone()
    if not row:
        return None
    return {
        "species": row["species"],
        "length": int(row["length"]),
        "caughtAt": int(row["caught_at"]),
    }


def window_count(conn: sqlite3.Connection, uid: str, cutoff: int):
    row = conn.execute(
        """
        SELECT COUNT(*) AS n, MAX(caught_at) AS last_catch, MAX(length) AS biggest
        FROM catches WHERE uid = ? AND caught_at >= ?
        """,
        (uid, cutoff),
    ).fetchone()
    return (
        int(row["n"] or 0),
        int(row["last_catch"] or 0) if row["last_catch"] else None,
        int(row["biggest"] or 0) if row["biggest"] else 0,
    )


def backpack_items(conn: sqlite3.Connection, uid: str, cutoff: int, limit: int = 60):
    rows = conn.execute(
        """
        SELECT id, species, length, caught_at
        FROM catches
        WHERE uid = ? AND caught_at >= ?
        ORDER BY caught_at DESC, id DESC
        LIMIT ?
        """,
        (uid, cutoff, limit),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "species": row["species"],
            "length": row["length"],
            "caughtAt": row["caught_at"],
        }
        for row in rows
    ]


def species_summary(conn: sqlite3.Connection, uid: str, cutoff: int):
    rows = conn.execute(
        """
        SELECT species, COUNT(*) AS count, MAX(length) AS biggest
        FROM catches
        WHERE uid = ? AND caught_at >= ?
        GROUP BY species
        ORDER BY count DESC, biggest DESC
        """,
        (uid, cutoff),
    ).fetchall()
    return [
        {
            "name": row["species"],
            "count": int(row["count"]),
            "biggest": int(row["biggest"]),
        }
        for row in rows
    ]


def leaderboard(conn: sqlite3.Connection, cutoff: int, me_uid: str, limit: int = 5):
    rows = conn.execute(
        """
        SELECT c.uid AS uid,
               COALESCE(NULLIF(u.name, ''), '无名钓客') AS name,
               COUNT(*) AS count,
               MAX(c.caught_at) AS last_catch
        FROM catches c
        LEFT JOIN users u ON u.uid = c.uid
        WHERE c.caught_at >= ?
        GROUP BY c.uid
        ORDER BY count DESC, last_catch DESC
        LIMIT ?
        """,
        (cutoff, limit),
    ).fetchall()
    return [
        {
            "name": row["name"],
            "count": int(row["count"]),
            "isMe": row["uid"] == me_uid,
        }
        for row in rows
    ]


def state_payload(conn: sqlite3.Connection, uid: str, create: bool = True, ip: str = "") -> dict:
    now = now_ts()
    cutoff = now - WINDOW_SECONDS
    if create:
        ensure_user(conn, uid, ip)
        conn.commit()
    row = user_row(conn, uid)
    count, last_catch, biggest = window_count(conn, uid, cutoff)
    expires_at = (last_catch + WINDOW_SECONDS) if last_catch else None
    return {
        "ok": True,
        "user": {
            "name": row["name"] if row else "",
            "createdAt": int(row["created_at"]) if row else now,
            "lastSeen": int(row["last_seen"]) if row else now,
            "count": count,
            "biggest": biggest,
            "expiresAt": expires_at,
        },
        "backpack": backpack_items(conn, uid, cutoff),
        "species": species_summary(conn, uid, cutoff),
        "leaderboard": leaderboard(conn, cutoff, uid),
        "daily": daily_payload(conn, uid),
        "encyclopedia": encyclopedia_payload(conn, uid),
        "personalBest": personal_best_payload(conn, uid),
        "windowDays": 30,
        "serverTime": now,
    }


def queue_feedback_email(feedback_id: int) -> None:
    threading.Thread(target=send_feedback_email, args=(feedback_id,), daemon=True).start()


def send_feedback_email(feedback_id: int) -> None:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT id, message, contact, page, ip, created_at FROM feedback WHERE id = ?",
            (feedback_id,),
        ).fetchone()
        if not row:
            return
        created = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(int(row["created_at"])))
        payload = {
            "name": "林间小屋 · 用户反馈",
            "message": row["message"],
            "contact": row["contact"] or "未填写",
            "page": row["page"] or "未知",
            "ip": row["ip"] or "未知",
            "time": created,
            "_subject": "林间小屋 · 新反馈 " + created,
            "_template": "table",
            "_captcha": "false",
        }
        status = "failed"
        error = ""
        try:
            request = urllib.request.Request(
                FEEDBACK_RELAY_URL,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Origin": FEEDBACK_SITE,
                    "Referer": FEEDBACK_SITE + "/",
                    "User-Agent": "ForestCabinFeedback/1.0",
                },
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=12) as response:
                raw = response.read().decode("utf-8", "replace")
            result = json.loads(raw)
            message = str(result.get("message", ""))
            if str(result.get("success", "")).lower() == "true":
                status = "sent"
            elif "activation" in message.lower():
                status = "activation"
                error = message[:400]
            else:
                error = (message or "relay rejected")[:400]
        except Exception as exc:
            error = str(exc)[:400]
        conn.execute(
            "UPDATE feedback SET email_status = ?, email_error = ? WHERE id = ?",
            (status, error, feedback_id),
        )
        conn.commit()
    finally:
        conn.close()


def admin_feedback_list(conn: sqlite3.Connection, limit: int = 30) -> dict:
    limit = max(1, min(100, limit))
    rows = conn.execute(
        """
        SELECT id, message, contact, page, ip, created_at, email_status, email_error
        FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return {
        "ok": True,
        "feedback": [
            {
                "id": row["id"],
                "message": row["message"],
                "contact": row["contact"],
                "page": row["page"],
                "ip": row["ip"],
                "createdAt": int(row["created_at"]),
                "emailStatus": row["email_status"],
                "emailError": row["email_error"],
            }
            for row in rows
        ],
    }


def admin_audit_list(conn: sqlite3.Connection, limit: int = 30) -> dict:
    limit = max(1, min(100, limit))
    rows = conn.execute(
        """
        SELECT id, action, target, ip, detail, created_at
        FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return {
        "ok": True,
        "audit": [
            {
                "id": row["id"],
                "action": row["action"],
                "target": row["target"],
                "ip": row["ip"],
                "detail": row["detail"],
                "createdAt": int(row["created_at"]),
            }
            for row in rows
        ],
    }


def verify_admin_password(password: str) -> bool:
    if not ADMIN_SALT or not ADMIN_HASH:
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        ADMIN_SALT.encode("utf-8"),
        ADMIN_PBKDF2_ROUNDS,
    ).hex()
    return hmac.compare_digest(digest, ADMIN_HASH)


def admin_overview(conn: sqlite3.Connection) -> dict:
    now = now_ts()
    cutoff = now - WINDOW_SECONDS
    users_total = int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
    catches_total = int(conn.execute("SELECT COUNT(*) FROM catches").fetchone()[0])
    catches_recent = int(
        conn.execute("SELECT COUNT(*) FROM catches WHERE caught_at >= ?", (cutoff,)).fetchone()[0]
    )
    active_users = int(
        conn.execute(
            "SELECT COUNT(DISTINCT uid) FROM catches WHERE caught_at >= ?",
            (cutoff,),
        ).fetchone()[0]
    )
    last_catch = conn.execute("SELECT MAX(caught_at) FROM catches").fetchone()[0]
    species_rows = conn.execute(
        """
        SELECT species, COUNT(*) AS count, MAX(length) AS biggest
        FROM catches WHERE caught_at >= ?
        GROUP BY species ORDER BY count DESC, biggest DESC LIMIT 5
        """,
        (cutoff,),
    ).fetchall()
    return {
        "ok": True,
        "users": users_total,
        "catchesTotal": catches_total,
        "catches30d": catches_recent,
        "activeUsers30d": active_users,
        "lastCatch": last_catch,
        "species30d": [
            {"name": row["species"], "count": int(row["count"]), "biggest": int(row["biggest"] or 0)}
            for row in species_rows
        ],
        "serverTime": now,
        "windowDays": 30,
    }


def admin_user_list(conn: sqlite3.Connection, query: str, page: int, limit: int) -> dict:
    now = now_ts()
    cutoff = now - WINDOW_SECONDS
    query = clean_text(query, 40)
    page = max(1, page)
    limit = max(1, min(50, limit))
    offset = (page - 1) * limit

    where = ""
    params: list = []
    if query:
        where = "WHERE u.name LIKE ? OR u.uid LIKE ? OR u.last_ip LIKE ?"
        like = "%" + query + "%"
        params = [like, like, like]

    total = int(conn.execute("SELECT COUNT(*) FROM users u " + where, params).fetchone()[0])
    rows = conn.execute(
        """
        SELECT u.uid, u.name, u.created_at, u.last_seen, u.last_ip,
               g.country AS geo_country, g.region AS geo_region, g.city AS geo_city,
               g.isp AS geo_isp, g.status AS geo_status,
               (SELECT COUNT(*) FROM catches c WHERE c.uid = u.uid) AS total_catches,
               (SELECT COUNT(*) FROM catches c WHERE c.uid = u.uid AND c.caught_at >= ?) AS recent_catches,
               (SELECT MAX(c.caught_at) FROM catches c WHERE c.uid = u.uid) AS last_catch
        FROM users u LEFT JOIN ip_geo g ON g.ip = u.last_ip
        """
        + where
        + """
        ORDER BY COALESCE(NULLIF(u.last_seen, 0), u.updated_at) DESC
        LIMIT ? OFFSET ?
        """,
        [cutoff] + params + [limit, offset],
    ).fetchall()

    for row in rows:
        if row["last_ip"]:
            queue_ip_geo(row["last_ip"])

    return {
        "ok": True,
        "page": page,
        "limit": limit,
        "total": total,
        "pages": max(1, (total + limit - 1) // limit),
        "users": [
            {
                "uid": row["uid"],
                "name": row["name"],
                "createdAt": int(row["created_at"]),
                "lastSeen": int(row["last_seen"]),
                "lastIp": row["last_ip"] or "",
                "ipLocation": location_text(row["geo_country"], row["geo_region"], row["geo_city"]),
                "ipIsp": row["geo_isp"] or "",
                "ipStatus": row["geo_status"] or ("pending" if row["last_ip"] else ""),
                "totalCatches": int(row["total_catches"]),
                "count30d": int(row["recent_catches"]),
                "lastCatch": int(row["last_catch"]) if row["last_catch"] else None,
            }
            for row in rows
        ],
        "serverTime": now,
    }


def admin_user_detail(conn: sqlite3.Connection, uid: str) -> dict | None:
    now = now_ts()
    cutoff = now - WINDOW_SECONDS
    row = conn.execute(
        """
        SELECT u.uid, u.name, u.created_at, u.updated_at, u.last_seen, u.last_ip,
               g.country AS geo_country, g.region AS geo_region, g.city AS geo_city,
               g.isp AS geo_isp, g.status AS geo_status
        FROM users u LEFT JOIN ip_geo g ON g.ip = u.last_ip
        WHERE u.uid = ?
        """,
        (uid,),
    ).fetchone()
    if not row:
        return None
    catches = conn.execute(
        """
        SELECT id, species, length, caught_at FROM catches
        WHERE uid = ? ORDER BY caught_at DESC, id DESC LIMIT 100
        """,
        (uid,),
    ).fetchall()
    if row["last_ip"]:
        queue_ip_geo(row["last_ip"])
    count_30d = int(
        conn.execute(
            "SELECT COUNT(*) FROM catches WHERE uid = ? AND caught_at >= ?",
            (uid, cutoff),
        ).fetchone()[0]
    )
    total = int(conn.execute("SELECT COUNT(*) FROM catches WHERE uid = ?", (uid,)).fetchone()[0])
    return {
        "ok": True,
        "user": {
            "uid": row["uid"],
            "name": row["name"],
            "createdAt": int(row["created_at"]),
            "updatedAt": int(row["updated_at"]),
            "lastSeen": int(row["last_seen"]),
            "lastIp": row["last_ip"] or "",
            "ipLocation": location_text(row["geo_country"], row["geo_region"], row["geo_city"]),
            "ipIsp": row["geo_isp"] or "",
            "ipStatus": row["geo_status"] or ("pending" if row["last_ip"] else ""),
            "totalCatches": total,
            "count30d": count_30d,
        },
        "backpack": [
            {
                "id": item["id"],
                "species": item["species"],
                "length": item["length"],
                "caughtAt": item["caught_at"],
            }
            for item in catches
        ],
        "serverTime": now,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ForestCabinBackpack/2.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def _is_https(self) -> bool:
        return (self.headers.get("X-Forwarded-Proto", "") or "").lower() == "https"

    def _cookie_secure(self) -> str:
        return "; Secure" if self._is_https() else ""

    def _json(self, status: int, payload: dict, set_cookie: str | None = None, extra_headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        if getattr(self, "_new_uid", None):
            self.send_header(
                "Set-Cookie",
                "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s"
                % (COOKIE_NAME, self._new_uid, COOKIE_MAX_AGE, self._cookie_secure()),
            )
            self._new_uid = None
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str, extra_headers: dict | None = None) -> None:
        self._json(status, {"ok": False, "error": message}, extra_headers=extra_headers)

    def _cookie_uid(self) -> str:
        cookie_header = self.headers.get("Cookie", "")
        if not cookie_header:
            return ""
        try:
            cookie = SimpleCookie()
            cookie.load(cookie_header)
            morsel = cookie.get(COOKIE_NAME)
            if morsel and UID_RE.match(morsel.value):
                return morsel.value
        except Exception:
            pass
        return ""

    def _uid(self, legacy_uid: str | None = None) -> str:
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            try:
                cookie = SimpleCookie()
                cookie.load(cookie_header)
                morsel = cookie.get(COOKIE_NAME)
                if morsel and UID_RE.match(morsel.value):
                    return morsel.value
            except Exception:
                pass
        # One-time migration from the old localStorage identity.
        if legacy_uid and UID_RE.match(legacy_uid):
            self._new_uid = legacy_uid
            return legacy_uid
        uid = secrets.token_urlsafe(18)
        self._new_uid = uid
        return uid

    def _client_ip(self) -> str:
        raw = self.headers.get("X-Real-IP", "")
        if not raw:
            forwarded = self.headers.get("X-Forwarded-For", "")
            if forwarded:
                raw = forwarded.split(",", 1)[0]
        ip = normalize_ip(raw)
        if ip:
            return ip
        return normalize_ip(self.client_address[0])

    def _read_json(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def _admin_cookie_value(self) -> str:
        cookie_header = self.headers.get("Cookie", "")
        if not cookie_header:
            return ""
        try:
            cookie = SimpleCookie()
            cookie.load(cookie_header)
            morsel = cookie.get(ADMIN_COOKIE)
            return morsel.value if morsel else ""
        except Exception:
            return ""

    def _admin_session(self) -> dict | None:
        token = self._admin_cookie_value()
        if not token:
            return None
        now = now_ts()
        with _admin_lock:
            session = _admin_sessions.get(token)
            if not session or int(session.get("expires", 0)) <= now:
                _admin_sessions.pop(token, None)
                return None
            return session

    def _admin_guard(self, require_csrf: bool = False) -> bool:
        if self.headers.get("X-Admin-Request", "") != "1":
            self.close_connection = True
            self._error(403, "missing admin request header")
            return False
        session = self._admin_session()
        if session is None:
            self.close_connection = True
            self._error(401, "admin login required")
            return False
        if require_csrf:
            supplied = self.headers.get("X-CSRF-Token", "")
            expected = str(session.get("csrf", ""))
            if not supplied or not expected or not hmac.compare_digest(supplied, expected):
                self.close_connection = True
                self._error(403, "invalid csrf token")
                return False
        self._admin_session_data = session
        return True

    def _audit(self, action: str, target: str = "", detail: str = "", conn=None) -> None:
        own = conn is None
        if own:
            conn = connect()
        try:
            conn.execute(
                "INSERT INTO admin_audit(action, target, ip, detail, created_at) VALUES(?, ?, ?, ?, ?)",
                (action, target, self._client_ip(), detail[:500], now_ts()),
            )
            if own:
                conn.commit()
        finally:
            if own:
                conn.close()

    def _admin_login(self) -> None:
        data = self._read_json()
        ip = self._client_ip()
        now = time.time()
        with _admin_failure_lock:
            recent = [stamp for stamp in _admin_failures.get(ip, []) if now - stamp < 300]
            _admin_failures[ip] = recent
            if len(recent) >= 8:
                self._error(429, "too many login attempts", {"Retry-After": "300"})
                return

        if not ADMIN_SALT or not ADMIN_HASH:
            self._error(503, "admin password not configured")
            return

        password = data.get("password", "") if data else ""
        if not isinstance(password, str) or not verify_admin_password(password):
            with _admin_failure_lock:
                _admin_failures.setdefault(ip, []).append(now)
            self._audit("login_failed")
            self._error(401, "invalid password")
            return

        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        expires = now_ts() + ADMIN_SESSION_SECONDS
        with _admin_lock:
            _admin_sessions[token] = {"expires": expires, "csrf": csrf}
        with _admin_failure_lock:
            _admin_failures.pop(ip, None)

        cookie = (
            "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Strict%s"
            % (ADMIN_COOKIE, token, ADMIN_SESSION_SECONDS, self._cookie_secure())
        )
        self._audit("login_success")
        self._json(200, {"ok": True, "expiresAt": expires, "csrfToken": csrf}, set_cookie=cookie)

    def _admin_logout(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            content_length = 0
        if content_length > 0:
            self._read_json()
        token = self._admin_cookie_value()
        if token:
            with _admin_lock:
                _admin_sessions.pop(token, None)
        self._audit("logout")
        cookie = "%s=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict%s" % (ADMIN_COOKIE, self._cookie_secure())
        self._json(200, {"ok": True}, set_cookie=cookie)

    def _admin_get(self, parsed) -> None:
        if not self._admin_guard():
            return
        query = parse_qs(parsed.query)
        path = parsed.path
        conn = connect()
        try:
            if path == "/api/fishing/admin/session":
                session = getattr(self, "_admin_session_data", {})
                self._json(200, {
                    "ok": True,
                    "csrfToken": session.get("csrf", ""),
                    "expiresAt": session.get("expires", 0),
                })
                return
            if path == "/api/fishing/admin/overview":
                self._json(200, admin_overview(conn))
                return
            if path == "/api/fishing/admin/users":
                try:
                    page = int((query.get("page") or ["1"])[0])
                    limit = int((query.get("limit") or ["20"])[0])
                except ValueError:
                    self._error(400, "invalid pagination")
                    return
                q = (query.get("q") or [""])[0]
                self._json(200, admin_user_list(conn, q, page, limit))
                return
            if path == "/api/fishing/admin/audit":
                try:
                    limit = int((query.get("limit") or ["30"])[0])
                except ValueError:
                    limit = 30
                self._json(200, admin_audit_list(conn, limit))
                return
            if path == "/api/fishing/admin/feedback":
                try:
                    limit = int((query.get("limit") or ["30"])[0])
                except ValueError:
                    limit = 30
                self._json(200, admin_feedback_list(conn, limit))
                return
            if path == "/api/fishing/admin/user":
                uid = (query.get("uid") or [""])[0]
                if not UID_RE.match(uid):
                    self._error(400, "invalid uid")
                    return
                detail = admin_user_detail(conn, uid)
                if detail is None:
                    self._error(404, "user not found")
                else:
                    self._json(200, detail)
                return
            self._error(404, "not found")
        finally:
            conn.close()

    def _admin_post(self, parsed) -> None:
        path = parsed.path
        if path == "/api/fishing/admin/login":
            self._admin_login()
            return
        if path == "/api/fishing/admin/logout":
            self._admin_logout()
            return
        if not self._admin_guard(require_csrf=True):
            return

        data = self._read_json()
        if data is None:
            self._error(400, "invalid json")
            return

        conn = connect()
        try:
            if path == "/api/fishing/admin/update-user":
                uid = data.get("uid", "")
                if not isinstance(uid, str) or not UID_RE.match(uid):
                    self._error(400, "invalid uid")
                    return
                name = clean_text(data.get("name", ""), MAX_NAME)
                if name == "无名钓客":
                    self._error(409, "这个称呼不可用")
                    return
                if name:
                    conflict = conn.execute(
                        "SELECT uid FROM users WHERE name = ? COLLATE NOCASE AND uid <> ?",
                        (name, uid),
                    ).fetchone()
                    if conflict:
                        self._error(409, "这个称呼已经有人用了")
                        return
                now = now_ts()
                try:
                    cursor = conn.execute(
                        "UPDATE users SET name = ?, updated_at = ? WHERE uid = ?",
                        (name, now, uid),
                    )
                    conn.commit()
                except sqlite3.IntegrityError:
                    conn.rollback()
                    self._error(409, "这个称呼已经有人用了")
                    return
                if cursor.rowcount == 0:
                    self._error(404, "user not found")
                else:
                    self._audit("update_user", uid, "name changed")
                    self._json(200, {"ok": True, "uid": uid, "name": name})
                return

            if path == "/api/fishing/admin/delete-user":
                uid = data.get("uid", "")
                if not isinstance(uid, str) or not UID_RE.match(uid):
                    self._error(400, "invalid uid")
                    return
                conn.execute("DELETE FROM catches WHERE uid = ?", (uid,))
                conn.execute("DELETE FROM feedback WHERE uid = ?", (uid,))
                conn.execute("DELETE FROM daily_quests WHERE uid = ?", (uid,))
                conn.execute("DELETE FROM daily_streaks WHERE uid = ?", (uid,))
                cursor = conn.execute("DELETE FROM users WHERE uid = ?", (uid,))
                conn.commit()
                if cursor.rowcount == 0:
                    self._error(404, "user not found")
                else:
                    self._audit("delete_user", uid)
                    self._json(200, {"ok": True, "deletedUser": uid})
                return

            if path == "/api/fishing/admin/delete-catch":
                try:
                    catch_id = int(data.get("id", 0))
                except (TypeError, ValueError):
                    catch_id = 0
                if catch_id <= 0:
                    self._error(400, "invalid catch id")
                    return
                cursor = conn.execute("DELETE FROM catches WHERE id = ?", (catch_id,))
                conn.commit()
                if cursor.rowcount == 0:
                    self._error(404, "catch not found")
                else:
                    self._audit("delete_catch", str(catch_id))
                    self._json(200, {"ok": True, "deletedCatch": catch_id})
                return

            self._error(404, "not found")
        finally:
            conn.close()

    def _handle_feedback(self) -> None:
        data = self._read_json()
        if data is None:
            self._error(400, "invalid json")
            return

        # Hidden honeypot: silently accept bot submissions without storing them.
        if clean_text(data.get("website", ""), 20):
            self._json(200, {"ok": True, "queued": True})
            return

        message = clean_feedback_text(data.get("message", ""), 1000)
        if len(message) < 2:
            self._error(400, "反馈内容太短")
            return
        contact = clean_text(data.get("contact", ""), 80)
        page = clean_text(data.get("page", ""), 200)
        ip = self._client_ip()
        now = time.time()

        with _feedback_lock:
            recent = [
                stamp
                for stamp in _feedback_times.get(ip, [])
                if now - stamp < FEEDBACK_RATE_SECONDS
            ]
            _feedback_times[ip] = recent
            if len(recent) >= FEEDBACK_RATE_LIMIT:
                self._error(429, "反馈太频繁，请稍后再试")
                return

        conn = connect()
        try:
            cursor = conn.execute(
                """
                INSERT INTO feedback(uid, message, contact, page, ip, created_at, email_status)
                VALUES(?, ?, ?, ?, ?, ?, 'pending')
                """,
                (self._cookie_uid(), message, contact, page, ip, now_ts()),
            )
            conn.commit()
            feedback_id = cursor.lastrowid
        finally:
            conn.close()

        with _feedback_lock:
            _feedback_times.setdefault(ip, []).append(now)
        queue_feedback_email(feedback_id)
        self._json(200, {"ok": True, "queued": True})

    def do_GET(self):
        self._new_uid = None
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/fishing/admin/"):
                self._admin_get(parsed)
                return
            if parsed.path == "/api/fishing/health":
                self._json(200, {"ok": True, "service": "forest-cabin-backpack", "windowDays": 30})
                return
            if parsed.path != "/api/fishing/me":
                self._error(404, "not found")
                return

            query = parse_qs(parsed.query)
            legacy_uid = (query.get("legacy_uid") or [None])[0]
            uid = self._uid(legacy_uid)
            ip = self._client_ip()
            conn = connect()
            try:
                cleanup(conn)
                payload = state_payload(conn, uid, create=True, ip=ip)
                queue_ip_geo(ip)
                self._json(200, payload)
            finally:
                conn.close()
        except Exception as exc:
            self.log_error("GET failed: %s", exc)
            self._error(500, "internal error")

    def do_POST(self):
        self._new_uid = None
        try:
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/fishing/admin/"):
                self._admin_post(parsed)
                return
            if parsed.path == "/api/fishing/feedback":
                self._handle_feedback()
                return
            if parsed.path not in ("/api/fishing/catch", "/api/fishing/profile"):
                self._error(404, "not found")
                return

            data = self._read_json()
            if data is None:
                self._error(400, "invalid json")
                return

            query = parse_qs(parsed.query)
            legacy_uid = (query.get("legacy_uid") or [None])[0]
            uid = self._uid(legacy_uid)
            ip = self._client_ip()
            if parsed.path == "/api/fishing/profile":
                self._handle_profile(uid, data, ip)
            else:
                self._handle_catch(uid, data, ip)
        except Exception as exc:
            self.log_error("POST failed: %s", exc)
            self._error(500, "internal error")

    def _handle_profile(self, uid: str, data: dict, ip: str = "") -> None:
        name = clean_text(data.get("name", ""), MAX_NAME)
        now = now_ts()
        conn = connect()
        try:
            cleanup(conn)
            ensure_user(conn, uid, ip)
            queue_ip_geo(ip)
            if name == "无名钓客":
                self._error(409, "这个称呼不可用")
                return
            if name:
                conflict = conn.execute(
                    "SELECT uid FROM users WHERE name = ? COLLATE NOCASE AND uid <> ?",
                    (name, uid),
                ).fetchone()
                if conflict:
                    self._error(409, "这个称呼已经有人用了")
                    return
            try:
                conn.execute(
                    "UPDATE users SET name = ?, updated_at = ?, last_seen = ? WHERE uid = ?",
                    (name, now, now, uid),
                )
                conn.commit()
            except sqlite3.IntegrityError:
                conn.rollback()
                self._error(409, "这个称呼已经有人用了")
                return
            self._json(200, {"ok": True, "name": name})
        finally:
            conn.close()

    def _handle_catch(self, uid: str, data: dict, ip: str = "") -> None:
        event_id = data.get("event_id", "")
        if not isinstance(event_id, str) or not EVENT_RE.match(event_id):
            self._error(400, "invalid event id")
            return

        species = clean_text(data.get("species", ""), 16)
        if species not in FISH_LIMITS:
            self._error(400, "未知鱼种")
            return
        conditions = get_fishing_conditions()
        if not species_allowed(species, conditions):
            self._error(400, "这个时段没有这种鱼")
            return
        try:
            length = int(data.get("length", 0))
        except (TypeError, ValueError):
            length = 0
        min_length, max_length = FISH_LIMITS[species]
        if length < min_length or length > max_length:
            self._error(400, "鱼的长度不合理")
            return
        now = now_ts()
        cutoff = now - WINDOW_SECONDS

        conn = connect()
        try:
            cleanup(conn)
            ensure_user(conn, uid, ip)
            queue_ip_geo(ip)
            conn.execute("UPDATE users SET updated_at = ? WHERE uid = ?", (now, uid))

            existing = conn.execute(
                "SELECT id, species, length, caught_at FROM catches WHERE event_id = ?",
                (event_id,),
            ).fetchone()
            if existing:
                conn.commit()
                payload = state_payload(conn, uid, create=False)
                payload.update({
                    "duplicate": True,
                    "item": {
                        "id": existing["id"],
                        "species": existing["species"],
                        "length": existing["length"],
                        "caughtAt": existing["caught_at"],
                    },
                })
                self._json(200, payload)
                return

            minute_count = int(
                conn.execute(
                    "SELECT COUNT(*) FROM catches WHERE uid = ? AND caught_at >= ?",
                    (uid, now - 60),
                ).fetchone()[0]
            )
            day_count = int(
                conn.execute(
                    "SELECT COUNT(*) FROM catches WHERE uid = ? AND caught_at >= ?",
                    (uid, now - 86400),
                ).fetchone()[0]
            )
            if minute_count >= CATCH_RATE_PER_MINUTE or day_count >= CATCH_RATE_PER_DAY:
                self._error(429, "渔获太频繁，请稍后再试")
                return

            cursor = conn.execute(
                "INSERT INTO catches(event_id, uid, species, length, caught_at) VALUES(?, ?, ?, ?, ?)",
                (event_id, uid, species, length, now),
            )
            advance_daily_quest(conn, uid, species)
            conn.commit()
            item = {
                "id": cursor.lastrowid,
                "species": species,
                "length": length,
                "caughtAt": now,
            }
            payload = state_payload(conn, uid, create=False)
            payload.update({"duplicate": False, "item": item})
            self._json(200, payload)
        finally:
            conn.close()


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print("Forest Cabin backpack API listening on http://%s:%d" % (HOST, PORT), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
