#!/usr/bin/env python3
"""Создать или обновить пользователя Timesheet."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from werkzeug.security import generate_password_hash

from server import app, get_db, init_db


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or update a Timesheet user")
    parser.add_argument("username")
    parser.add_argument("password")
    parser.add_argument("--role", choices=("user", "admin"), default="user")
    parser.add_argument("--fio", default="", help="default_fio for user role")
    args = parser.parse_args()

    with app.app_context():
        init_db()
        db = get_db()
        password_hash = generate_password_hash(args.password)
        existing = db.execute(
            "SELECT id FROM users WHERE username = ?", (args.username,)
        ).fetchone()
        if existing:
            db.execute(
                "UPDATE users SET password_hash = ?, role = ?, default_fio = ? WHERE id = ?",
                (password_hash, args.role, args.fio, existing["id"]),
            )
            action = "updated"
        else:
            db.execute(
                "INSERT INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)",
                (args.username, password_hash, args.role, args.fio),
            )
            action = "created"
        db.commit()

    print(f"User {args.username!r} {action} (role={args.role})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
