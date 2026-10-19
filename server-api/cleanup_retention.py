#!/usr/bin/env python3
"""Apply tiered retention from a daily systemd timer."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app

app.init_db()
conn = app.connect()
try:
    app.cleanup(conn, force=True)
finally:
    conn.close()
