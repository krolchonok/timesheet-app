'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieSession = require('cookie-session');
const Database = require('better-sqlite3');

const BASE_DIR = __dirname;
const DB_PATH = path.join(BASE_DIR, 'data', 'timesheet.db');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKLY_HOURS_NORM = 40;
const TASK_STATUSES = ['new', 'editing', 'transferred'];
const DEFAULT_TASK_STATUS = 'new';
const DEV_SECRET_KEY = 'timesheet-dev-secret-change-me';
const ADMIN_TASK_CATEGORY = 'Административные задачи';

function isProduction() {
  return (process.env.TIMESHEET_ENV || 'development').toLowerCase() === 'production';
}

function seedDemoEnabled() {
  const fallback = isProduction() ? '0' : '1';
  return (process.env.TIMESHEET_SEED_DEMO || fallback).trim() === '1';
}

// --- UI theme (visual only: default classic look, or an MS-Project-styled variant) ---
const UI_THEMES = ['default', 'msproject'];
const UI_THEME_PLACEHOLDER = '__UI_THEME_DEFAULT__';

function uiThemeDefault() {
  const value = (process.env.UI_THEME || 'default').trim().toLowerCase();
  return UI_THEMES.includes(value) ? value : 'default';
}

const htmlPageCache = new Map();

function sendThemedHtml(res, filename) {
  let template = htmlPageCache.get(filename);
  if (template === undefined) {
    template = fs.readFileSync(path.join(BASE_DIR, filename), 'utf8');
    if (isProduction()) {
      htmlPageCache.set(filename, template);
    }
  }
  const html = template.replace(UI_THEME_PLACEHOLDER, uiThemeDefault());
  res.type('html').send(html);
}

// --- password hashing (pbkdf2, self-contained format: pbkdf2$iterations$salt$hash) ---
const PBKDF2_ITERATIONS = 260000;

function generatePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function checkPasswordHash(storedHash, password) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], 'hex');
  const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length, 'sha256');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

// --- date helpers ---
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function mondayOf(d) {
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  return monday;
}

function weekStartFor(day) {
  const current = day || new Date();
  return isoDate(mondayOf(current));
}

function parseWeekStart(value) {
  if (!value) return weekStartFor();
  const raw = String(value).trim().slice(0, 10);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return weekStartFor();
  const utcDay = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  return weekStartFor(utcDay);
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d+Z$/, '');
}

// --- db setup ---
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function migrateDb() {
  if (!columnExists('tasks', 'week_start')) {
    db.exec("ALTER TABLE tasks ADD COLUMN week_start TEXT NOT NULL DEFAULT ''");
    db.prepare("UPDATE tasks SET week_start = ? WHERE week_start = ''").run(weekStartFor());
  }

  if (!tableExists('people')) {
    db.exec(`
      CREATE TABLE people (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  if (!tableExists('project_task_templates')) {
    db.exec(`
      CREATE TABLE project_task_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  if (!columnExists('tasks', 'is_project')) {
    db.exec('ALTER TABLE tasks ADD COLUMN is_project INTEGER NOT NULL DEFAULT 0');
  }

  if (!tableExists('task_categories')) {
    db.exec(`
      CREATE TABLE task_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1
      );
    `);
  }

  if (!columnExists('tasks', 'category')) {
    db.exec("ALTER TABLE tasks ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  }
  if (!columnExists('tasks', 'final_task')) {
    db.exec("ALTER TABLE tasks ADD COLUMN final_task TEXT NOT NULL DEFAULT ''");
  }
  if (!columnExists('tasks', 'status')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT '${DEFAULT_TASK_STATUS}'`);
  }
}

function seedTaskCategories() {
  const defaults = ['Автоматизация процессов', 'Административные задачи', 'Макетирование'];
  const stmt = db.prepare('INSERT OR IGNORE INTO task_categories (name, sort_order) VALUES (?, ?)');
  defaults.forEach((name, index) => stmt.run(name, index));
}

function seedProjectTemplates() {
  const defaults = ['Проектные задачи'];
  const stmt = db.prepare('INSERT OR IGNORE INTO project_task_templates (name, sort_order) VALUES (?, ?)');
  defaults.forEach((name, index) => stmt.run(name, index));
  db.prepare('UPDATE project_task_templates SET active = 0 WHERE name = ?').run(ADMIN_TASK_CATEGORY);
  db.prepare(`
    UPDATE tasks SET is_project = 0, category = ?
    WHERE is_project = 1 AND task = ?
  `).run(ADMIN_TASK_CATEGORY, ADMIN_TASK_CATEGORY);
}

function seedPeople() {
  const demo = ['Иванов И.И.', 'Петров П.П.', 'Сидорова А.А.', 'Козлов Д.В.'];
  const stmt = db.prepare('INSERT OR IGNORE INTO people (name) VALUES (?)');
  demo.forEach((name) => stmt.run(name));
}

function syncOrphanTaskFio() {
  const peopleNames = db.prepare('SELECT name FROM people WHERE active = 1').all().map((r) => r.name);
  if (peopleNames.length === 0) return;

  const tasks = db.prepare('SELECT id, fio FROM tasks').all();
  const update = db.prepare('UPDATE tasks SET fio = ? WHERE id = ?');
  for (const task of tasks) {
    const fio = String(task.fio || '').trim();
    if (!fio || peopleNames.includes(fio)) continue;
    const match = peopleNames.find(
      (name) => name.startsWith(fio) || fio.startsWith(name.split(' ')[0])
    );
    if (match) update.run(match, task.id);
  }
}

function getPublicUserId() {
  let row = db.prepare("SELECT id FROM users WHERE username = '_public'").get();
  if (!row) {
    db.prepare(
      'INSERT OR IGNORE INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)'
    ).run('_public', generatePasswordHash(crypto.randomBytes(32).toString('hex')), 'public', '');
    row = db.prepare("SELECT id FROM users WHERE username = '_public'").get();
  }
  return row.id;
}

function ensureProjectTasks(fio, weekStart, userId) {
  const templates = db.prepare(`
    SELECT name FROM project_task_templates
    WHERE active = 1
    ORDER BY sort_order, name COLLATE NOCASE
  `).all();
  if (templates.length === 0) return;

  const now = utcNow();
  const exists = db.prepare(`
    SELECT id FROM tasks
    WHERE fio = ? AND week_start = ? AND is_project = 1 AND task = ?
  `);
  const insert = db.prepare(`
    INSERT INTO tasks (
        user_id, week_start, fio, task, is_project, category, final_task, status,
        mon, tue, wed, thu, fri, comment, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, '', '', ?, 0, 0, 0, 0, 0, '', ?, ?)
  `);
  for (const template of templates) {
    if (exists.get(fio, weekStart, template.name)) continue;
    insert.run(userId, weekStart, fio, template.name, DEFAULT_TASK_STATUS, now, now);
  }
}

function ensureProjectTasksForWeek(weekStart, userId, fio) {
  let names;
  if (fio) {
    names = [fio];
  } else {
    names = db.prepare('SELECT name FROM people WHERE active = 1 ORDER BY name COLLATE NOCASE').all().map((r) => r.name);
  }
  for (const name of names) ensureProjectTasks(name, weekStart, userId);
}

function hoursProgress(totalHours) {
  const norm = WEEKLY_HOURS_NORM;
  const percent = norm ? Math.min(100, Math.round((totalHours / norm) * 100)) : 0;
  return {
    total_hours: totalHours,
    hours_norm: norm,
    hours_percent: percent,
    hours_complete: totalHours >= norm,
  };
}

function rowsProjectHours(rows) {
  return rows
    .filter((row) => row.is_project)
    .reduce((sum, row) => sum + DAYS.reduce((s, day) => s + Number(row[day] || 0), 0), 0);
}

function rowsReportHours(rows) {
  return rows
    .filter((row) => !row.is_project)
    .reduce((sum, row) => sum + DAYS.reduce((s, day) => s + Number(row[day] || 0), 0), 0);
}

function rowsNormHours(rows) {
  return rowsProjectHours(rows) + rowsReportHours(rows);
}

function projectHoursTotal(tasks) {
  return tasks.filter((t) => t.is_project).reduce((sum, t) => sum + Number(t.total || 0), 0);
}

function reportHoursTotal(tasks) {
  return tasks.filter((t) => !t.is_project).reduce((sum, t) => sum + Number(t.total || 0), 0);
}

function progressWithBreakdown(tasks) {
  const projectHours = projectHoursTotal(tasks);
  const reportHours = reportHoursTotal(tasks);
  const totalHours = projectHours + reportHours;
  const progress = hoursProgress(totalHours);
  progress.project_hours = projectHours;
  progress.report_hours = reportHours;
  return progress;
}

function taskHasContent(row) {
  if (String(row.task || '').trim()) return true;
  return DAYS.reduce((s, day) => s + Number(row[day] || 0), 0) > 0;
}

function getActivePerson(name) {
  if (!name) return null;
  return db.prepare('SELECT * FROM people WHERE name = ? AND active = 1').get(String(name).trim());
}

function initDb() {
  db.exec(`
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
  `);

  migrateDb();
  seedPeople();
  seedProjectTemplates();
  seedTaskCategories();
  syncOrphanTaskFio();

  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (seedDemoEnabled()) {
    db.prepare(
      'INSERT OR IGNORE INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)'
    ).run('admin', generatePasswordHash('admin'), 'admin', 'Администратор');
    db.prepare(
      'INSERT OR IGNORE INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)'
    ).run('user', generatePasswordHash('user'), 'user', '');
  } else if (!admin) {
    const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
    const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();
    if (adminPassword) {
      db.prepare(
        'INSERT OR IGNORE INTO users (username, password_hash, role, default_fio) VALUES (?, ?, ?, ?)'
      ).run(adminUsername, generatePasswordHash(adminPassword), 'admin', 'Администратор');
    }
  }
}

// --- app setup ---
const SECRET_KEY = process.env.SECRET_KEY || DEV_SECRET_KEY;

if (isProduction() && (SECRET_KEY === DEV_SECRET_KEY || !SECRET_KEY)) {
  throw new Error('Set a strong SECRET_KEY when TIMESHEET_ENV=production');
}

initDb();

const app = express();
app.use(express.json());
app.use(
  cookieSession({
    name: 'session',
    keys: [SECRET_KEY],
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction() && process.env.SESSION_COOKIE_SECURE === '1',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
);

function currentUser(req) {
  const userId = req.session && req.session.user_id;
  if (!userId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) || null;
}

function loginRequired(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function adminRequired(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  req.user = user;
  next();
}

function taskRowToDict(row) {
  const data = { ...row };
  data.total = DAYS.reduce((sum, day) => sum + Number(data[day] || 0), 0);
  return data;
}

function normalizeTaskStatus(value) {
  const status = String(value || DEFAULT_TASK_STATUS).trim().toLowerCase();
  return TASK_STATUSES.includes(status) ? status : DEFAULT_TASK_STATUS;
}

function parseTaskPayload(payload, { admin = false } = {}) {
  const result = {
    fio: String(payload.fio || '').trim(),
    task: String(payload.task || '').trim(),
    category: String(payload.category || '').trim(),
    comment: String(payload.comment || '').trim(),
    week_start: parseWeekStart(payload.week_start),
  };
  if (admin) {
    result.final_task = String(payload.final_task || '').trim();
    result.status = normalizeTaskStatus(payload.status);
  }
  for (const day of DAYS) {
    let value = parseFloat(String(payload[day] ?? 0).replace(',', '.'));
    if (!Number.isFinite(value)) value = 0;
    result[day] = Math.max(0, value);
  }
  return result;
}

function getTask(taskId) {
  return db.prepare(`
    SELECT tasks.*, users.username AS owner_username
    FROM tasks
    JOIN users ON users.id = tasks.user_id
    WHERE tasks.id = ?
  `).get(taskId);
}

function canAccessTask(user, taskRow) {
  if (user && user.role === 'admin') return true;
  if (user && user.role !== 'public' && taskRow.user_id === user.id) return true;
  return getActivePerson(taskRow.fio) != null;
}

// --- static pages ---
app.get('/', (req, res) => sendThemedHtml(res, 'index.html'));
app.get('/login', (req, res) => sendThemedHtml(res, 'login.html'));
app.get('/admin', (req, res) => sendThemedHtml(res, 'admin.html'));

// --- auth ---
app.post('/api/login', (req, res) => {
  const payload = req.body || {};
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !checkPasswordHash(user.password_hash, password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  req.session = { user_id: user.id };
  res.json({ id: user.id, username: user.username, role: user.role, default_fio: user.default_fio });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', loginRequired, (req, res) => {
  const user = req.user;
  res.json({ id: user.id, username: user.username, role: user.role, default_fio: user.default_fio });
});

app.put('/api/me', loginRequired, (req, res) => {
  const user = req.user;
  const payload = req.body || {};
  const defaultFio = String(payload.default_fio ?? user.default_fio).trim();
  db.prepare('UPDATE users SET default_fio = ? WHERE id = ?').run(defaultFio, user.id);
  res.json({ default_fio: defaultFio });
});

// --- tasks ---
app.get('/api/tasks', (req, res) => {
  const user = currentUser(req);
  const week = parseWeekStart(req.query.week);
  let fio = String(req.query.fio || '').trim();

  let rows;
  if (user && user.role === 'admin') {
    ensureProjectTasksForWeek(week, user.id, fio || null);
    let query = `
      SELECT tasks.*, users.username AS owner_username
      FROM tasks
      JOIN users ON users.id = tasks.user_id
      WHERE tasks.week_start = ?
    `;
    const params = [week];
    if (fio) {
      query += ' AND tasks.fio = ?';
      params.push(fio);
    }
    query += ' ORDER BY tasks.is_project DESC, tasks.task COLLATE NOCASE, tasks.updated_at DESC, tasks.id DESC';
    rows = db.prepare(query).all(...params);
  } else {
    if (!fio) return res.json({ tasks: [], progress: hoursProgress(0) });
    const person = getActivePerson(fio);
    if (!person) return res.json({ tasks: [], progress: hoursProgress(0) });
    fio = person.name;
    ensureProjectTasks(fio, week, getPublicUserId());
    rows = db.prepare(`
      SELECT tasks.*, users.username AS owner_username
      FROM tasks
      JOIN users ON users.id = tasks.user_id
      WHERE tasks.week_start = ? AND tasks.fio = ?
      ORDER BY tasks.is_project DESC, tasks.task COLLATE NOCASE, tasks.updated_at DESC, tasks.id DESC
    `).all(week, fio);
  }
  const tasks = rows.map(taskRowToDict);
  res.json({ tasks, progress: progressWithBreakdown(tasks) });
});

app.get('/api/weeks', (req, res) => {
  const rows = db.prepare(`
    SELECT week_start, COUNT(*) AS task_count
    FROM tasks
    GROUP BY week_start
    ORDER BY week_start DESC
  `).all();
  res.json(rows.map((row) => ({ week_start: row.week_start, task_count: row.task_count })));
});

app.post('/api/tasks', (req, res) => {
  const user = currentUser(req);
  const body = req.body || {};
  const payload = parseTaskPayload(body);
  payload.week_start = parseWeekStart(req.query.week || body.week_start);
  const now = utcNow();

  let targetUserId = user && user.role !== 'public' ? user.id : getPublicUserId();
  if (user && user.role === 'admin' && req.query.user_id) {
    targetUserId = parseInt(req.query.user_id, 10);
  }

  if (payload.fio === '' && user && user.default_fio) {
    payload.fio = user.default_fio;
  }

  if (!user || user.role !== 'admin') {
    const person = getActivePerson(payload.fio);
    if (!person) return res.status(400).json({ error: 'Выберите ФИО из списка' });
    payload.fio = person.name;
  }

  const cur = db.prepare(`
    INSERT INTO tasks (
        user_id, week_start, fio, task, is_project, category, final_task, status,
        mon, tue, wed, thu, fri, comment, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    targetUserId,
    payload.week_start,
    payload.fio,
    payload.task,
    payload.category,
    DEFAULT_TASK_STATUS,
    payload.mon,
    payload.tue,
    payload.wed,
    payload.thu,
    payload.fri,
    payload.comment,
    now,
    now
  );
  const row = getTask(cur.lastInsertRowid);
  res.status(201).json(taskRowToDict(row));
});

app.put('/api/tasks/:taskId', (req, res) => {
  const taskId = parseInt(req.params.taskId, 10);
  const user = currentUser(req);
  const row = getTask(taskId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canAccessTask(user, row)) return res.status(403).json({ error: 'Forbidden' });

  const payload = req.body || {};
  const isAdmin = !!(user && user.role === 'admin');
  const parsed = parseTaskPayload(payload, { admin: isAdmin });
  const now = utcNow();

  const weekStart = payload.week_start ? parsed.week_start : row.week_start;
  let fio = payload.fio ? parsed.fio : row.fio;
  if (!('category' in payload)) parsed.category = String(row.category || '');
  if (!('task' in payload)) parsed.task = String(row.task || '');
  if (!('comment' in payload)) parsed.comment = String(row.comment || '');
  let finalTask = isAdmin && 'final_task' in payload ? parsed.final_task : String(row.final_task || '');
  let status = isAdmin && 'status' in payload ? parsed.status : normalizeTaskStatus(row.status);

  if (row.is_project) {
    parsed.task = row.task;
    parsed.category = '';
    parsed.comment = String(row.comment || '');
    finalTask = '';
    status = DEFAULT_TASK_STATUS;
  } else if (!isAdmin) {
    const person = getActivePerson(fio);
    if (!person) return res.status(400).json({ error: 'Выберите ФИО из списка' });
    fio = person.name;
    if (status !== 'transferred') {
      const taskChanged = parsed.task !== String(row.task || '');
      const categoryChanged = parsed.category !== String(row.category || '');
      if (taskChanged || categoryChanged) status = 'editing';
    }
  }

  db.prepare(`
    UPDATE tasks
    SET fio = ?, task = ?, category = ?, final_task = ?, status = ?,
        mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, comment = ?, week_start = ?, updated_at = ?
    WHERE id = ?
  `).run(
    fio,
    parsed.task,
    parsed.category,
    finalTask,
    status,
    parsed.mon,
    parsed.tue,
    parsed.wed,
    parsed.thu,
    parsed.fri,
    parsed.comment,
    weekStart,
    now,
    taskId
  );
  res.json(taskRowToDict(getTask(taskId)));
});

app.delete('/api/tasks/:taskId', (req, res) => {
  const taskId = parseInt(req.params.taskId, 10);
  const user = currentUser(req);
  const row = getTask(taskId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canAccessTask(user, row)) return res.status(403).json({ error: 'Forbidden' });
  if (row.is_project && (!user || user.role !== 'admin')) {
    return res.status(403).json({ error: 'Проектные задачи нельзя удалять' });
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  res.json({ ok: true });
});

app.post('/api/tasks/:taskId/copy', (req, res) => {
  const taskId = parseInt(req.params.taskId, 10);
  const user = currentUser(req);
  const row = getTask(taskId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canAccessTask(user, row)) return res.status(403).json({ error: 'Forbidden' });

  const payload = req.body || {};
  let targetUserId = row.user_id;
  if (user && user.role === 'admin' && payload.user_id) {
    targetUserId = parseInt(payload.user_id, 10);
  } else if (!user || user.role !== 'admin') {
    targetUserId = getPublicUserId();
  }

  const weekStart = parseWeekStart(payload.week_start || row.week_start);
  const now = utcNow();
  const cur = db.prepare(`
    INSERT INTO tasks (
        user_id, week_start, fio, task, is_project, category, final_task, status,
        mon, tue, wed, thu, fri, comment, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    targetUserId,
    weekStart,
    row.fio,
    row.task,
    row.is_project,
    row.category,
    DEFAULT_TASK_STATUS,
    row.mon,
    row.tue,
    row.wed,
    row.thu,
    row.fri,
    row.comment,
    now,
    now
  );
  res.status(201).json(taskRowToDict(getTask(cur.lastInsertRowid)));
});

app.post('/api/tasks/:taskId/transfer', adminRequired, (req, res) => {
  const taskId = parseInt(req.params.taskId, 10);
  const row = getTask(taskId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.is_project) {
    return res.status(400).json({ error: 'Проектные задачи — только индикатор, перенос недоступен' });
  }

  const now = utcNow();
  const finalTask = String(row.task || '').trim();
  db.prepare(`
    UPDATE tasks
    SET final_task = ?, status = 'transferred', updated_at = ?
    WHERE id = ?
  `).run(finalTask, now, taskId);
  res.json(taskRowToDict(getTask(taskId)));
});

// --- users ---
app.get('/api/users', adminRequired, (req, res) => {
  const rows = db.prepare('SELECT id, username, role, default_fio FROM users ORDER BY username').all();
  res.json(rows);
});

// --- people ---
app.get('/api/people', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM people WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
  res.json(rows);
});

app.post('/api/people', adminRequired, (req, res) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите ФИО' });
  const exists = db.prepare('SELECT id FROM people WHERE name = ?').get(name);
  if (exists) {
    db.prepare('UPDATE people SET active = 1 WHERE id = ?').run(exists.id);
    return res.json(db.prepare('SELECT id, name FROM people WHERE id = ?').get(exists.id));
  }
  const cur = db.prepare('INSERT INTO people (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT id, name FROM people WHERE id = ?').get(cur.lastInsertRowid));
});

app.delete('/api/people/:personId', adminRequired, (req, res) => {
  const personId = parseInt(req.params.personId, 10);
  const row = db.prepare('SELECT id FROM people WHERE id = ?').get(personId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE people SET active = 0 WHERE id = ?').run(personId);
  res.json({ ok: true });
});

// --- completion ---
app.get('/api/completion', adminRequired, (req, res) => {
  const week = parseWeekStart(req.query.week);
  const user = req.user;
  ensureProjectTasksForWeek(week, user.id);
  const people = db.prepare('SELECT id, name FROM people WHERE active = 1 ORDER BY name COLLATE NOCASE').all();

  const result = [];
  let filledCount = 0;
  for (const person of people) {
    const tasks = db.prepare('SELECT * FROM tasks WHERE week_start = ? AND fio = ?').all(week, person.name);
    const meaningful = tasks.filter((task) => !task.is_project && taskHasContent(task));
    const projectHours = rowsProjectHours(tasks);
    const reportHours = rowsReportHours(tasks);
    const totalHours = rowsNormHours(tasks);
    const progress = hoursProgress(totalHours);
    const filled = progress.hours_complete;
    if (filled) filledCount += 1;
    const editors = db.prepare(`
      SELECT DISTINCT users.username
      FROM tasks
      JOIN users ON users.id = tasks.user_id
      WHERE tasks.week_start = ? AND tasks.fio = ? AND tasks.is_project = 0
      ORDER BY users.username
    `).all(week, person.name);
    result.push({
      id: person.id,
      name: person.name,
      filled,
      task_count: meaningful.length,
      filled_tasks: meaningful.length,
      project_hours: projectHours,
      report_hours: reportHours,
      total_hours: totalHours,
      hours_norm: progress.hours_norm,
      hours_percent: progress.hours_percent,
      hours_complete: progress.hours_complete,
      editors: editors.map((row) => row.username),
    });
  }

  res.json({
    week_start: week,
    total: result.length,
    filled_count: filledCount,
    missing_count: result.length - filledCount,
    people: result,
  });
});

// --- project templates ---
app.get('/api/project-templates', loginRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, sort_order
    FROM project_task_templates
    WHERE active = 1
    ORDER BY sort_order, name COLLATE NOCASE
  `).all();
  res.json(rows);
});

app.post('/api/project-templates', adminRequired, (req, res) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название' });
  const exists = db.prepare('SELECT id FROM project_task_templates WHERE name = ?').get(name);
  if (exists) {
    db.prepare('UPDATE project_task_templates SET active = 1 WHERE id = ?').run(exists.id);
    return res.json(db.prepare('SELECT id, name, sort_order FROM project_task_templates WHERE id = ?').get(exists.id));
  }
  const cur = db.prepare('INSERT INTO project_task_templates (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT id, name, sort_order FROM project_task_templates WHERE id = ?').get(cur.lastInsertRowid));
});

app.delete('/api/project-templates/:templateId', adminRequired, (req, res) => {
  const templateId = parseInt(req.params.templateId, 10);
  const row = db.prepare('SELECT id FROM project_task_templates WHERE id = ?').get(templateId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE project_task_templates SET active = 0 WHERE id = ?').run(templateId);
  res.json({ ok: true });
});

// --- categories ---
app.get('/api/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, sort_order
    FROM task_categories
    WHERE active = 1
    ORDER BY sort_order, name COLLATE NOCASE
  `).all();
  res.json(rows);
});

app.post('/api/categories', adminRequired, (req, res) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название категории' });
  const exists = db.prepare('SELECT id FROM task_categories WHERE name = ?').get(name);
  if (exists) {
    db.prepare('UPDATE task_categories SET active = 1 WHERE id = ?').run(exists.id);
    return res.json(db.prepare('SELECT id, name, sort_order FROM task_categories WHERE id = ?').get(exists.id));
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM task_categories').get().max_order;
  const cur = db.prepare('INSERT INTO task_categories (name, sort_order) VALUES (?, ?)').run(name, maxOrder + 1);
  res.status(201).json(db.prepare('SELECT id, name, sort_order FROM task_categories WHERE id = ?').get(cur.lastInsertRowid));
});

app.delete('/api/categories/:categoryId', adminRequired, (req, res) => {
  const categoryId = parseInt(req.params.categoryId, 10);
  const row = db.prepare('SELECT id FROM task_categories WHERE id = ?').get(categoryId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE task_categories SET active = 0 WHERE id = ?').run(categoryId);
  res.json({ ok: true });
});

// static assets: explicit allowlist only — never blanket-serve BASE_DIR
// (that would also expose .env, data/timesheet.db, server.js, node_modules, etc.)
const STATIC_FILES = ['styles.css', 'app.js', 'admin.js', 'login.js', 'api.js', 'week.js', 'table-resize.js', 'tour.js'];
for (const file of STATIC_FILES) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(BASE_DIR, file)));
}

if (require.main === module) {
  const host = process.env.HOST || '0.0.0.0';
  const port = parseInt(process.env.PORT || '8888', 10);
  app.listen(port, host, () => {
    console.log(`Timesheet listening on http://${host}:${port}`);
  });
}

module.exports = { app, db, initDb, generatePasswordHash };
