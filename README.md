# Timesheet

Веб-таблица учёта задач и часов с экспортом в MS Project.

**Репозиторий:** https://github.com/krolchonok/timesheet

## Запуск

```bash
git clone https://github.com/krolchonok/timesheet.git
cd timesheet
npm install
cp .env.example .env   # задайте SECRET_KEY
npm start
```

Открыть: http://127.0.0.1:8888 — расписание доступно всем без входа. Админ-панель: `/login` → `/admin`.

Порт — `PORT` в `.env` (по умолчанию **8888**). Проверка: `ss -tlnp | grep :8888`

Dev-режим (demo admin):

```bash
npm run dev
```

## Пользователи

```bash
node scripts/create-user.js admin 'password' --role admin
node scripts/create-user.js ivanov 'password' --role user
```

Или `ADMIN_USERNAME` / `ADMIN_PASSWORD` в `.env` до первого запуска.

## systemd

```bash
sudo ./install.sh
```

## Стек

Node.js + Express + better-sqlite3.

Подробнее: [INSTRUCTION.md](INSTRUCTION.md) · установка на сервер: [INSTALL.md](INSTALL.md)
