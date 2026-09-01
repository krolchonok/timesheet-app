# Установка на сервере

```bash
git clone https://github.com/krolchonok/timesheet.git
cd timesheet
npm install
cp .env.example .env
# SECRET_KEY=...  TIMESHEET_SEED_DEMO=0  PORT=8888

npm start
```

Фон через systemd:

```bash
sudo ./install.sh
```

Nginx на другом ПК: [deploy/nginx-timesheet.conf](deploy/nginx-timesheet.conf)
