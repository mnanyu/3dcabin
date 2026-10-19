#!/usr/bin/env python3
"""Print an ADMIN_SALT/ADMIN_HASH pair for a new admin password."""
import hashlib
import secrets
import sys

if len(sys.argv) != 2 or not sys.argv[1]:
    raise SystemExit("usage: python3 set_admin_password.py '<new password>'")

password = sys.argv[1]
salt = secrets.token_hex(16)
digest = hashlib.pbkdf2_hmac(
    "sha256", password.encode("utf-8"), salt.encode("utf-8"), 210_000
).hex()
print("ADMIN_SALT=" + salt)
print("ADMIN_HASH=" + digest)
