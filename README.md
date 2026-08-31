# Timesheet

Веб-таблица учёта задач и часов с экспортом в MS Project.

**Репозиторий:** https://github.com/krolchonok/timesheet

## Запуск

```bash
git clone https://github.com/krolchonok/timesheet.git
cd timesheet
cp .env.example .env   # задайте SECRET_KEY
chmod +x start
./start
```

Открыть: http://127.0.0.1:8888/login

Порт — `PORT` в `.env` (по умолчанию **8888**). Проверка: `./start status`

Dev-режим (demo admin/user):

```bash
./start dev
```

## Пользователи

```bash
python3 scripts/create_user.py admin 'password' --role admin
python3 scripts/create_user.py ivanov 'password' --role user
```

Или `ADMIN_USERNAME` / `ADMIN_PASSWORD` в `.env` до первого запуска.

## systemd

```bash
sudo ./install.sh
```

## Стек

Python 3 + Flask + gunicorn + SQLite.

Подробнее: [INSTRUCTION.md](INSTRUCTION.md) · установка на сервер: [INSTALL.md](INSTALL.md)
