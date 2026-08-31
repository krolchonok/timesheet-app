#!/usr/bin/env bash
# Установщик Timesheet как systemd-сервиса.
# Копирует проект в INSTALL_DIR (по умолчанию /opt/timesheet), ставит зависимости,
# генерирует .env с SECRET_KEY, создаёт unit-файл systemd и запускает сервис.
#
# Использование:
#   sudo ./install.sh [INSTALL_DIR]

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: запустите установщик от root: sudo ./install.sh" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${1:-/opt/timesheet}"
SERVICE_USER="${SERVICE_USER:-www-data}"
SERVICE_NAME="timesheet"

echo "==> Устанавливаю Timesheet в ${INSTALL_DIR}"

command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 не найден в PATH." >&2; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync не найден. Установите его (apt install rsync / yum install rsync)." >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "ERROR: systemctl не найден — этот установщик рассчитан на systemd." >&2; exit 1; }

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "==> Создаю системного пользователя ${SERVICE_USER}"
  useradd --system --no-create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

echo "==> Копирую файлы проекта"
mkdir -p "${INSTALL_DIR}"
rsync -a --delete \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude 'venv' \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude '.env' \
  "${SOURCE_DIR}/" "${INSTALL_DIR}/"
mkdir -p "${INSTALL_DIR}/data"
chmod +x "${INSTALL_DIR}/start"

cd "${INSTALL_DIR}"

echo "==> Создаю venv и ставлю зависимости"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
touch .venv/.deps_ok

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  echo "==> Создаю .env"
  cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"

  SECRET_KEY="$(openssl rand -hex 32 2>/dev/null || head -c48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c64)"
  sed -i "s#^SECRET_KEY=.*#SECRET_KEY=${SECRET_KEY}#" "${INSTALL_DIR}/.env"

  read -rp "Логин администратора [admin]: " ADMIN_USERNAME
  ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  while true; do
    read -rsp "Пароль администратора: " ADMIN_PASSWORD
    echo
    [[ -n "${ADMIN_PASSWORD}" ]] && break
    echo "Пароль не может быть пустым."
  done

  if grep -q '^#\?ADMIN_USERNAME=' "${INSTALL_DIR}/.env"; then
    sed -i "s|^#\?ADMIN_USERNAME=.*|ADMIN_USERNAME=${ADMIN_USERNAME}|" "${INSTALL_DIR}/.env"
  else
    echo "ADMIN_USERNAME=${ADMIN_USERNAME}" >> "${INSTALL_DIR}/.env"
  fi
  if grep -q '^#\?ADMIN_PASSWORD=' "${INSTALL_DIR}/.env"; then
    sed -i "s|^#\?ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" "${INSTALL_DIR}/.env"
  else
    echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> "${INSTALL_DIR}/.env"
  fi
  unset ADMIN_PASSWORD
else
  echo "==> .env уже существует, пропускаю генерацию"
fi

chmod 600 "${INSTALL_DIR}/.env"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

echo "==> Устанавливаю systemd unit"
sed \
  -e "s#/opt/timesheet#${INSTALL_DIR}#g" \
  -e "s#User=www-data#User=${SERVICE_USER}#" \
  "${INSTALL_DIR}/deploy/timesheet.service" > "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

echo ""
echo "==> Готово. Статус сервиса:"
systemctl --no-pager status "${SERVICE_NAME}" || true
echo ""
echo "Логи:      journalctl -u ${SERVICE_NAME} -f"
echo "Перезапуск: systemctl restart ${SERVICE_NAME}"
