#!/usr/bin/env python3
import os
import sqlite3
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "data" / "timesheet.db"

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
app.secret_key = os.environ.get("SECRET_KEY", "timesheet-dev-secret-change-me")

DAYS = ("mon", "tue", "wed", "thu", "fri")
WEEKLY_HOURS_NORM = 40
TASK_STATUSES = ("new", "editing", "transferred")
DEFAULT_TASK_STATUS = "new"
DEV_SECRET_KEY = "timesheet-dev-secret-change-me"


def is_production() -> bool:
    return os.environ.get("TIMESHEET_ENV", "development").lower() == "production"


def seed_demo_enabled() -> bool:
    default = "0" if is_production() else "1"
    return os.environ.get("TIMESHEET_SEED_DEMO", default).strip() == "1"


def configure_app() -> None:
    if is_production():
        if app.secret_key == DEV_SECRET_KEY or not app.secret_key:
            raise RuntimeError("Set a strong SECRET_KEY when TIMESHEET_ENV=production")
        app.config["SESSION_COOKIE_HTTPONLY"] = True
        app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
        app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "1") == "1"


def week_start_for(day: date | None = None) -> str:
    current = day or date.today()
    monday = current - timedelta(days=current.weekday())
    return monday.isoformat()


def parse_week_start(value: str | None) -> str:
    if not value:
        return week_start_for()
    try:
        parsed = date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return week_start_for()
    return week_start_for(parsed)


def migrate_db(db: sqlite3.Connection):
    columns = {row[1] for row in db.execute("PRAGMA table_info(tasks)").fetchall()}
    if "week_start" not in columns:
        db.execute("ALTER TABLE tasks ADD COLUMN week_start TEXT NOT NULL DEFAULT ''")
        db.execute("UPDATE tasks SET week_start = ? WHERE week_start = ''", (week_start_for(),))
        db.commit()

    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "people" not in tables:
        db.executescript(
            """
            CREATE TABLE people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            );
            """
        )
        db.commit()

    if "project_task_templates" not in tables:
        db.executescript(
            """
            CREATE TABLE project_task_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1
            );
            """
        )
        db.commit()

    columns = {row[1] for row in db.execute("PRAGMA table_info(tasks)").fetchall()}
    if "is_project" not in columns:
        db.execute("ALTER TABLE tasks ADD COLUMN is_project INTEGER NOT NULL DEFAULT 0")
        db.commit()

    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "task_categories" not in tables:
        db.executescript(
            """
            CREATE TABLE task_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1
            );
            """
        )
        db.commit()

    columns = {row[1] for row in db.execute("PRAGMA table_info(tasks)").fetchall()}
    if "category" not in columns:
        db.execute("ALTER TABLE tasks ADD COLUMN category TEXT NOT NULL DEFAULT ''")
        db.commit()
    if "final_task" not in columns:
        db.execute("ALTER TABLE tasks ADD COLUMN final_task TEXT NOT NULL DEFAULT ''")
        db.commit()
    if "status" not in columns:
        db.execute(
            f"ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT '{DEFAULT_TASK_STATUS}'"
        )
        db.commit()


def seed_task_categories(db: sqlite3.Connection):
    defaults = [
        "Автоматизация процессов",
        "Административные задачи",
        "Макетирование",
    ]
    for index, name in enumerate(defaults):
        exists = db.execute("SELECT id FROM task_categories WHERE name = ?", (name,)).fetchone()
        if exists is None:
            db.execute(
                "INSERT INTO task_categories (name, sort_order) VALUES (?, ?)",
                (name, index),
            )
    db.commit()


ADMIN_TASK_CATEGORY = "Административные задачи"


def seed_project_templates(db: sqlite3.Connection):
    defaults = ["Проектные задачи"]
    for index, name in enumerate(defaults):
        exists = db.execute("SELECT id FROM project_task_templates WHERE name = ?", (name,)).fetchone()
        if exists is None:
            db.execute(
                "INSERT INTO project_task_templates (name, sort_order) VALUES (?, ?)",
                (name, index),
            )
    db.commit()
    db.execute(
        "UPDATE project_task_templates SET active = 0 WHERE name = ?",
        (ADMIN_TASK_CATEGORY,),
    )
    db.execute(
        """
        UPDATE tasks SET is_project = 0, category = ?
        WHERE is_project = 1 AND task = ?
        """,
        (ADMIN_TASK_CATEGORY, ADMIN_TASK_CATEGORY),
    )
    db.commit()


def ensure_project_tasks_for_week(db: sqlite3.Connection, week_start: str, user_id: int, fio: str | None = None):
    if fio:
        names = [fio]
    else:
        names = [
            row["name"]
            for row in db.execute("SELECT name FROM people WHERE active = 1 ORDER BY name COLLATE NOCASE").fetchall()
        ]
    for name in names:
        ensure_project_tasks(db, name, week_start, user_id)


def ensure_project_tasks(db: sqlite3.Connection, fio: str, week_start: str, user_id: int):
    templates = db.execute(
        """
        SELECT name FROM project_task_templates
        WHERE active = 1
        ORDER BY sort_order, name COLLATE NOCASE
        """
    ).fetchall()
    if not templates:
        return

    now = utc_now()
    for template in templates:
        exists = db.execute(
            """
            SELECT id FROM tasks
            WHERE fio = ? AND week_start = ? AND is_project = 1 AND task = ?
            """,
            (fio, week_start, template["name"]),
        ).fetchone()
        if exists:
            continue
        db.execute(
            """
            INSERT INTO tasks (
                user_id, week_start, fio, task, is_project, category, final_task, status,
                mon, tue, wed, thu, fri, comment, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 1, '', '', ?, 0, 0, 0, 0, 0, '', ?, ?)
            """,
            (user_id, week_start, fio, template["name"], DEFAULT_TASK_STATUS, now, now),
        )
    db.commit()


def hours_progress(total_hours: float) -> dict:
    norm = WEEKLY_HOURS_NORM
    percent = min(100, round((total_hours / norm) * 100)) if norm else 0
    return {
        "total_hours": total_hours,
        "hours_norm": norm,
        "hours_percent": percent,
        "hours_complete": total_hours >= norm,
    }


def sync_orphan_task_fio(db: sqlite3.Connection):
    people_names = [
        row["name"]
        for row in db.execute("SELECT name FROM people WHERE active = 1").fetchall()
    ]
    if not people_names:
        return

    tasks = db.execute("SELECT id, fio FROM tasks").fetchall()
    for task in tasks:
        fio = str(task["fio"] or "").strip()
        if not fio or fio in people_names:
            continue

        match = next(
            (
                name
                for name in people_names
                if name.startswith(fio) or fio.startswith(name.split()[0])
            ),
            None,
        )
        if match:
            db.execute("UPDATE tasks SET fio = ? WHERE id = ?", (match, task["id"]))

    db.commit()


def seed_people(db: sqlite3.Connection):
    demo = ["Иванов И.И.", "Петров П.П.", "Сидорова А.А.", "Козлов Д.В."]
    for name in demo:
        exists = db.execute("SELECT id FROM people WHERE name = ?", (name,)).fetchone()
        if exists is None:
            db.execute("INSERT INTO people (name) VALUES (?)", (name,))
    db.commit()


def rows_admin_hours(rows: list) -> float:
    return sum(
        sum(float(row[day] or 0) for day in DAYS)
        for row in rows
        if not row["is_project"] and str(row["category"] or "") == ADMIN_TASK_CATEGORY
    )


def rows_norm_hours(rows: list) -> float:
    return rows_project_hours(rows) + rows_admin_hours(rows)


def tasks_norm_hours(tasks: list[dict]) -> float:
    total = 0.0
    for task in tasks:
        hours = float(task.get("total", 0) or 0)
        if task.get("is_project"):
            total += hours
        elif str(task.get("category") or "") == ADMIN_TASK_CATEGORY:
            total += hours
    return total


def project_hours_total(tasks: list[dict]) -> float:
    return sum(float(task.get("total", 0) or 0) for task in tasks if task.get("is_project"))


def admin_hours_total(tasks: list[dict]) -> float:
    return sum(
        float(task.get("total", 0) or 0)
        for task in tasks
        if not task.get("is_project") and str(task.get("category") or "") == ADMIN_TASK_CATEGORY
    )


def progress_with_breakdown(tasks: list[dict]) -> dict:
    project_hours = project_hours_total(tasks)
    admin_hours = admin_hours_total(tasks)
    total_hours = project_hours + admin_hours
    progress = hours_progress(total_hours)
    progress["project_hours"] = project_hours
    progress["admin_hours"] = admin_hours
    return progress


def rows_project_hours(rows: list) -> float:
    return sum(
        sum(float(row[day] or 0) for day in DAYS)
        for row in rows
        if row["is_project"]
    )


def task_has_content(row: sqlite3.Row) -> bool:
    if str(row["task"] or "").strip():
        return True
    return sum(float(row[day] or 0) for day in DAYS) > 0


def get_active_person(name: str | None):
    if not name:
        return None
    return get_db().execute(
        "SELECT * FROM people WHERE name = ? AND active = 1",
        (str(name).strip(),),
    ).fetchone()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            default_fio TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            fio TEXT NOT NULL DEFAULT '',
            task TEXT NOT NULL DEFAULT '',
            mon REAL NOT NULL DEFAULT 0,
            tue REAL NOT NULL DEFAULT 0,
            wed REAL NOT NULL DEFAULT 0,
            thu REAL NOT NULL DEFAULT 0,
            fri REAL NOT NULL DEFAULT 0,
            comment TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            active INTEGER NOT NULL DEFAULT 1
        );
        """
    )

    migrate_db(db)
    seed_people(db)
    seed_project_templates(db)
    seed_task_categories(db)
    sync_orphan_task_fio(db)

    admin = db.execute("SELECT id FROM users WHERE username = ?", ("admin",)).fetchone()
    if seed_demo_enabled():
        if admin is None:
            db.execute(
                "INSERT INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)",
                ("admin", generate_password_hash("admin"), "admin", "Администратор"),
            )
        user = db.execute("SELECT id FROM users WHERE username = ?", ("user",)).fetchone()
        if user is None:
            db.execute(
                "INSERT INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)",
                ("user", generate_password_hash("user"), "user", ""),
            )
    elif admin is None:
        admin_username = os.environ.get("ADMIN_USERNAME", "admin").strip() or "admin"
        admin_password = os.environ.get("ADMIN_PASSWORD", "").strip()
        if admin_password:
            db.execute(
                "INSERT INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)",
                (
                    admin_username,
                    generate_password_hash(admin_password),
                    "admin",
                    "Администратор",
                ),
            )

    db.commit()


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify({"error": "Unauthorized"}), 401
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify({"error": "Unauthorized"}), 401
        if user["role"] != "admin":
            return jsonify({"error": "Forbidden"}), 403
        return view(*args, **kwargs)

    return wrapped


def task_row_to_dict(row: sqlite3.Row) -> dict:
    data = dict(row)
    data["total"] = sum(float(data.get(day, 0) or 0) for day in DAYS)
    return data


def normalize_task_status(value: str | None) -> str:
    status = str(value or DEFAULT_TASK_STATUS).strip().lower()
    return status if status in TASK_STATUSES else DEFAULT_TASK_STATUS


def parse_task_payload(payload: dict, *, admin: bool = False) -> dict:
    result = {
        "fio": str(payload.get("fio", "")).strip(),
        "task": str(payload.get("task", "")).strip(),
        "category": str(payload.get("category", "")).strip(),
        "comment": str(payload.get("comment", "")).strip(),
        "week_start": parse_week_start(payload.get("week_start")),
    }
    if admin:
        result["final_task"] = str(payload.get("final_task", "")).strip()
        result["status"] = normalize_task_status(payload.get("status"))
    for day in DAYS:
        try:
            value = float(str(payload.get(day, 0)).replace(",", "."))
        except (TypeError, ValueError):
            value = 0
        result[day] = max(0.0, value)
    return result


def get_task(task_id: int):
    return get_db().execute(
        """
        SELECT tasks.*, users.username AS owner_username
        FROM tasks
        JOIN users ON users.id = tasks.user_id
        WHERE tasks.id = ?
        """,
        (task_id,),
    ).fetchone()


def can_access_task(user, task_row) -> bool:
    return user["role"] == "admin" or task_row["user_id"] == user["id"]


@app.get("/")
def index_page():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/login")
def login_page():
    return send_from_directory(BASE_DIR, "login.html")


@app.get("/admin")
def admin_page():
    return send_from_directory(BASE_DIR, "admin.html")


@app.post("/api/login")
def api_login():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))

    user = get_db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if user is None or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Неверный логин или пароль"}), 401

    session.clear()
    session["user_id"] = user["id"]
    return jsonify(
        {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "default_fio": user["default_fio"],
        }
    )


@app.post("/api/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def api_me():
    user = current_user()
    return jsonify(
        {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "default_fio": user["default_fio"],
        }
    )


@app.put("/api/me")
@login_required
def api_update_me():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    default_fio = str(payload.get("default_fio", user["default_fio"])).strip()
    get_db().execute("UPDATE users SET default_fio = ? WHERE id = ?", (default_fio, user["id"]))
    get_db().commit()
    return jsonify({"default_fio": default_fio})


@app.get("/api/tasks")
@login_required
def api_list_tasks():
    user = current_user()
    week = parse_week_start(request.args.get("week"))
    fio = str(request.args.get("fio", "")).strip()

    if user["role"] == "admin":
        db = get_db()
        ensure_project_tasks_for_week(db, week, user["id"], fio or None)
        query = """
            SELECT tasks.*, users.username AS owner_username
            FROM tasks
            JOIN users ON users.id = tasks.user_id
            WHERE tasks.week_start = ?
        """
        params: list = [week]
        if fio:
            query += " AND tasks.fio = ?"
            params.append(fio)
        query += " ORDER BY tasks.is_project DESC, tasks.task COLLATE NOCASE, tasks.updated_at DESC, tasks.id DESC"
        rows = db.execute(query, params).fetchall()
    else:
        if not fio:
            return jsonify({"tasks": [], "progress": hours_progress(0)})
        person = get_active_person(fio)
        if person is None:
            return jsonify({"tasks": [], "progress": hours_progress(0)})
        fio = person["name"]
        ensure_project_tasks(get_db(), fio, week, user["id"])
        rows = get_db().execute(
            """
            SELECT tasks.*, users.username AS owner_username
            FROM tasks
            JOIN users ON users.id = tasks.user_id
            WHERE tasks.week_start = ? AND tasks.fio = ?
            ORDER BY tasks.is_project DESC, tasks.task COLLATE NOCASE, tasks.updated_at DESC, tasks.id DESC
            """,
            (week, fio),
        ).fetchall()
    tasks = [task_row_to_dict(row) for row in rows]
    return jsonify({"tasks": tasks, "progress": progress_with_breakdown(tasks)})


@app.get("/api/weeks")
@login_required
def api_list_weeks():
    user = current_user()
    if user["role"] == "admin":
        rows = get_db().execute(
            """
            SELECT week_start, COUNT(*) AS task_count
            FROM tasks
            GROUP BY week_start
            ORDER BY week_start DESC
            """
        ).fetchall()
    else:
        rows = get_db().execute(
            """
            SELECT week_start, COUNT(*) AS task_count
            FROM tasks
            WHERE user_id = ?
            GROUP BY week_start
            ORDER BY week_start DESC
            """,
            (user["id"],),
        ).fetchall()
    return jsonify([{"week_start": row["week_start"], "task_count": row["task_count"]} for row in rows])


@app.post("/api/tasks")
@login_required
def api_create_task():
    user = current_user()
    body = request.get_json(silent=True) or {}
    payload = parse_task_payload(body)
    payload["week_start"] = parse_week_start(request.args.get("week") or body.get("week_start"))
    now = utc_now()

    target_user_id = user["id"]
    if user["role"] == "admin" and request.args.get("user_id"):
        target_user_id = int(request.args["user_id"])

    if payload["fio"] == "" and user["default_fio"]:
        payload["fio"] = user["default_fio"]

    if user["role"] != "admin":
        person = get_active_person(payload["fio"])
        if person is None:
            return jsonify({"error": "Выберите ФИО из списка"}), 400
        payload["fio"] = person["name"]

    cur = get_db().execute(
        """
        INSERT INTO tasks (
            user_id, week_start, fio, task, is_project, category, final_task, status,
            mon, tue, wed, thu, fri, comment, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            target_user_id,
            payload["week_start"],
            payload["fio"],
            payload["task"],
            payload["category"],
            DEFAULT_TASK_STATUS,
            payload["mon"],
            payload["tue"],
            payload["wed"],
            payload["thu"],
            payload["fri"],
            payload["comment"],
            now,
            now,
        ),
    )
    get_db().commit()
    row = get_task(cur.lastrowid)
    return jsonify(task_row_to_dict(row)), 201


@app.put("/api/tasks/<int:task_id>")
@login_required
def api_update_task(task_id: int):
    user = current_user()
    row = get_task(task_id)
    if row is None:
        return jsonify({"error": "Not found"}), 404
    if not can_access_task(user, row):
        return jsonify({"error": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    is_admin = user["role"] == "admin"
    parsed = parse_task_payload(payload, admin=is_admin)
    now = utc_now()

    week_start = parsed["week_start"] if payload.get("week_start") else row["week_start"]
    fio = parsed["fio"] if payload.get("fio") else row["fio"]
    if "category" not in payload:
        parsed["category"] = str(row["category"] or "")
    if "task" not in payload:
        parsed["task"] = str(row["task"] or "")
    if "comment" not in payload:
        parsed["comment"] = str(row["comment"] or "")
    final_task = parsed["final_task"] if is_admin and "final_task" in payload else str(row["final_task"] or "")
    status = parsed["status"] if is_admin and "status" in payload else normalize_task_status(row["status"])

    if row["is_project"]:
        parsed["task"] = row["task"]
        parsed["category"] = ""
        parsed["comment"] = str(row["comment"] or "")
        final_task = ""
        status = DEFAULT_TASK_STATUS
    elif user["role"] != "admin":
        person = get_active_person(fio)
        if person is None:
            return jsonify({"error": "Выберите ФИО из списка"}), 400
        fio = person["name"]
        if row["is_project"]:
            parsed["task"] = row["task"]
        elif status != "transferred":
            task_changed = parsed["task"] != str(row["task"] or "")
            category_changed = parsed["category"] != str(row["category"] or "")
            if task_changed or category_changed:
                status = "editing"

    get_db().execute(
        """
        UPDATE tasks
        SET fio = ?, task = ?, category = ?, final_task = ?, status = ?,
            mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, comment = ?, week_start = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            fio,
            parsed["task"],
            parsed["category"],
            final_task,
            status,
            parsed["mon"],
            parsed["tue"],
            parsed["wed"],
            parsed["thu"],
            parsed["fri"],
            parsed["comment"],
            week_start,
            now,
            task_id,
        ),
    )
    get_db().commit()
    return jsonify(task_row_to_dict(get_task(task_id)))


@app.delete("/api/tasks/<int:task_id>")
@login_required
def api_delete_task(task_id: int):
    user = current_user()
    row = get_task(task_id)
    if row is None:
        return jsonify({"error": "Not found"}), 404
    if not can_access_task(user, row):
        return jsonify({"error": "Forbidden"}), 403
    if row["is_project"] and user["role"] != "admin":
        return jsonify({"error": "Проектные задачи нельзя удалять"}), 403

    get_db().execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    get_db().commit()
    return jsonify({"ok": True})


@app.post("/api/tasks/<int:task_id>/copy")
@login_required
def api_copy_task(task_id: int):
    user = current_user()
    row = get_task(task_id)
    if row is None:
        return jsonify({"error": "Not found"}), 404
    if not can_access_task(user, row):
        return jsonify({"error": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    target_user_id = row["user_id"]
    if user["role"] == "admin" and payload.get("user_id"):
        target_user_id = int(payload["user_id"])
    elif user["role"] != "admin":
        target_user_id = user["id"]

    week_start = parse_week_start(payload.get("week_start") or row["week_start"])

    now = utc_now()
    cur = get_db().execute(
        """
        INSERT INTO tasks (
            user_id, week_start, fio, task, is_project, category, final_task, status,
            mon, tue, wed, thu, fri, comment, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            target_user_id,
            week_start,
            row["fio"],
            row["task"],
            row["is_project"],
            row["category"],
            DEFAULT_TASK_STATUS,
            row["mon"],
            row["tue"],
            row["wed"],
            row["thu"],
            row["fri"],
            row["comment"],
            now,
            now,
        ),
    )
    get_db().commit()
    return jsonify(task_row_to_dict(get_task(cur.lastrowid))), 201


@app.post("/api/tasks/<int:task_id>/transfer")
@admin_required
def api_transfer_task(task_id: int):
    row = get_task(task_id)
    if row is None:
        return jsonify({"error": "Not found"}), 404
    if row["is_project"]:
        return jsonify({"error": "Проектные задачи — только индикатор, перенос недоступен"}), 400

    now = utc_now()
    final_task = str(row["task"] or "").strip()
    get_db().execute(
        """
        UPDATE tasks
        SET final_task = ?, status = 'transferred', updated_at = ?
        WHERE id = ?
        """,
        (final_task, now, task_id),
    )
    get_db().commit()
    return jsonify(task_row_to_dict(get_task(task_id)))


@app.get("/api/users")
@admin_required
def api_list_users():
    rows = get_db().execute(
        "SELECT id, username, role, default_fio FROM users ORDER BY username"
    ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.get("/api/people")
@login_required
def api_list_people():
    rows = get_db().execute(
        "SELECT id, name FROM people WHERE active = 1 ORDER BY name COLLATE NOCASE"
    ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/people")
@admin_required
def api_create_person():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    if not name:
        return jsonify({"error": "Укажите ФИО"}), 400
    exists = get_db().execute("SELECT id FROM people WHERE name = ?", (name,)).fetchone()
    if exists:
        get_db().execute("UPDATE people SET active = 1 WHERE id = ?", (exists["id"],))
        get_db().commit()
        row = get_db().execute("SELECT id, name FROM people WHERE id = ?", (exists["id"],)).fetchone()
        return jsonify(dict(row))
    cur = get_db().execute("INSERT INTO people (name) VALUES (?)", (name,))
    get_db().commit()
    row = get_db().execute("SELECT id, name FROM people WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.delete("/api/people/<int:person_id>")
@admin_required
def api_delete_person(person_id: int):
    row = get_db().execute("SELECT id FROM people WHERE id = ?", (person_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Not found"}), 404
    get_db().execute("UPDATE people SET active = 0 WHERE id = ?", (person_id,))
    get_db().commit()
    return jsonify({"ok": True})


@app.get("/api/completion")
@admin_required
def api_completion():
    week = parse_week_start(request.args.get("week"))
    db = get_db()
    user = current_user()
    ensure_project_tasks_for_week(db, week, user["id"])
    people = db.execute(
        "SELECT id, name FROM people WHERE active = 1 ORDER BY name COLLATE NOCASE"
    ).fetchall()

    result = []
    filled_count = 0
    for person in people:
        tasks = get_db().execute(
            "SELECT * FROM tasks WHERE week_start = ? AND fio = ?",
            (week, person["name"]),
        ).fetchall()
        meaningful = [task for task in tasks if not task["is_project"] and task_has_content(task)]
        project_hours = rows_project_hours(tasks)
        admin_hours = rows_admin_hours(tasks)
        total_hours = rows_norm_hours(tasks)
        progress = hours_progress(total_hours)
        filled = progress["hours_complete"]
        if filled:
            filled_count += 1
        editors = get_db().execute(
            """
            SELECT DISTINCT users.username
            FROM tasks
            JOIN users ON users.id = tasks.user_id
            WHERE tasks.week_start = ? AND tasks.fio = ? AND tasks.is_project = 0
            ORDER BY users.username
            """,
            (week, person["name"]),
        ).fetchall()
        result.append(
            {
                "id": person["id"],
                "name": person["name"],
                "filled": filled,
                "task_count": len(meaningful),
                "filled_tasks": len(meaningful),
                "project_hours": project_hours,
                "admin_hours": admin_hours,
                "total_hours": total_hours,
                "hours_norm": progress["hours_norm"],
                "hours_percent": progress["hours_percent"],
                "hours_complete": progress["hours_complete"],
                "editors": [row["username"] for row in editors],
            }
        )

    return jsonify(
        {
            "week_start": week,
            "total": len(result),
            "filled_count": filled_count,
            "missing_count": len(result) - filled_count,
            "people": result,
        }
    )


@app.get("/api/project-templates")
@login_required
def api_list_project_templates():
    rows = get_db().execute(
        """
        SELECT id, name, sort_order
        FROM project_task_templates
        WHERE active = 1
        ORDER BY sort_order, name COLLATE NOCASE
        """
    ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/project-templates")
@admin_required
def api_create_project_template():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    if not name:
        return jsonify({"error": "Укажите название"}), 400
    exists = get_db().execute(
        "SELECT id FROM project_task_templates WHERE name = ?", (name,)
    ).fetchone()
    if exists:
        get_db().execute(
            "UPDATE project_task_templates SET active = 1 WHERE id = ?", (exists["id"],)
        )
        get_db().commit()
        row = get_db().execute(
            "SELECT id, name, sort_order FROM project_task_templates WHERE id = ?",
            (exists["id"],),
        ).fetchone()
        return jsonify(dict(row))
    cur = get_db().execute(
        "INSERT INTO project_task_templates (name) VALUES (?)", (name,)
    )
    get_db().commit()
    row = get_db().execute(
        "SELECT id, name, sort_order FROM project_task_templates WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return jsonify(dict(row)), 201


@app.delete("/api/project-templates/<int:template_id>")
@admin_required
def api_delete_project_template(template_id: int):
    row = get_db().execute(
        "SELECT id FROM project_task_templates WHERE id = ?", (template_id,)
    ).fetchone()
    if row is None:
        return jsonify({"error": "Not found"}), 404
    get_db().execute(
        "UPDATE project_task_templates SET active = 0 WHERE id = ?", (template_id,)
    )
    get_db().commit()
    return jsonify({"ok": True})


@app.get("/api/categories")
@login_required
def api_list_categories():
    rows = get_db().execute(
        """
        SELECT id, name, sort_order
        FROM task_categories
        WHERE active = 1
        ORDER BY sort_order, name COLLATE NOCASE
        """
    ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/categories")
@admin_required
def api_create_category():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    if not name:
        return jsonify({"error": "Укажите название категории"}), 400
    exists = get_db().execute(
        "SELECT id FROM task_categories WHERE name = ?", (name,)
    ).fetchone()
    if exists:
        get_db().execute(
            "UPDATE task_categories SET active = 1 WHERE id = ?", (exists["id"],)
        )
        get_db().commit()
        row = get_db().execute(
            "SELECT id, name, sort_order FROM task_categories WHERE id = ?",
            (exists["id"],),
        ).fetchone()
        return jsonify(dict(row))
    max_order = get_db().execute(
        "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM task_categories"
    ).fetchone()["max_order"]
    cur = get_db().execute(
        "INSERT INTO task_categories (name, sort_order) VALUES (?, ?)",
        (name, max_order + 1),
    )
    get_db().commit()
    row = get_db().execute(
        "SELECT id, name, sort_order FROM task_categories WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return jsonify(dict(row)), 201


@app.delete("/api/categories/<int:category_id>")
@admin_required
def api_delete_category(category_id: int):
    row = get_db().execute(
        "SELECT id FROM task_categories WHERE id = ?", (category_id,)
    ).fetchone()
    if row is None:
        return jsonify({"error": "Not found"}), 404
    get_db().execute(
        "UPDATE task_categories SET active = 0 WHERE id = ?", (category_id,)
    )
    get_db().commit()
    return jsonify({"ok": True})


with app.app_context():
    configure_app()
    init_db()


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8888"))
    app.run(host=host, port=port, debug=False)
