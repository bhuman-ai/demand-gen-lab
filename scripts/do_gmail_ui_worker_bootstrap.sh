#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0 [app-root] [data-root]" >&2
  exit 1
fi

APP_ROOT="${1:-/opt/lastb2b}"
DATA_ROOT="${2:-/srv/lastb2b-data}"
APP_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
if [[ -z "${APP_HOME}" ]]; then
  APP_HOME="/root"
fi
APP_GROUP="$(id -gn "${APP_USER}")"
DISPLAY_NUM="${GMAIL_UI_DISPLAY:-:99}"
SCREEN_SIZE="${GMAIL_UI_SCREEN_SIZE:-1440x980x24}"
NOVNC_PORT="${GMAIL_UI_NOVNC_PORT:-6080}"
VNC_PORT="${GMAIL_UI_VNC_PORT:-5900}"

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  jq \
  xdg-utils \
  xvfb \
  fluxbox \
  x11vnc \
  novnc \
  websockify \
  dbus-x11 \
  fonts-liberation \
  fonts-noto-color-emoji \
  fonts-dejavu-core

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v google-chrome-stable >/dev/null 2>&1; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
  chmod a+r /etc/apt/keyrings/google-chrome.gpg
  cat >/etc/apt/sources.list.d/google-chrome.list <<'EOF'
deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main
EOF
  apt-get update -y
  apt-get install -y google-chrome-stable
fi

install -d -o "${APP_USER}" -g "${APP_GROUP}" "${APP_ROOT}"
install -d -o "${APP_USER}" -g "${APP_GROUP}" "${DATA_ROOT}"
install -d -o "${APP_USER}" -g "${APP_GROUP}" "${DATA_ROOT}/gmail-ui-profiles"
install -d -o "${APP_USER}" -g "${APP_GROUP}" /var/log/lastb2b

cat >/usr/local/bin/lastb2b-gmail-ui-desktop.sh <<EOF
#!/usr/bin/env bash
set -euo pipefail
export DISPLAY="${DISPLAY_NUM}"
export XAUTHORITY="${APP_HOME}/.Xauthority"

if ! pgrep -f "Xvfb ${DISPLAY_NUM}" >/dev/null 2>&1; then
  Xvfb ${DISPLAY_NUM} -screen 0 ${SCREEN_SIZE} -ac +extension RANDR >/var/log/lastb2b/xvfb.log 2>&1 &
  sleep 2
fi

if ! pgrep -u "${APP_USER}" -f "fluxbox" >/dev/null 2>&1; then
  runuser -u "${APP_USER}" -- env DISPLAY="${DISPLAY_NUM}" fluxbox >/var/log/lastb2b/fluxbox.log 2>&1 &
  sleep 1
fi

if ! pgrep -f "x11vnc .*${VNC_PORT}" >/dev/null 2>&1; then
  x11vnc -display "${DISPLAY_NUM}" -rfbport "${VNC_PORT}" -localhost -forever -shared -nopw >/var/log/lastb2b/x11vnc.log 2>&1 &
  sleep 1
fi

exec /usr/share/novnc/utils/novnc_proxy --listen 127.0.0.1:${NOVNC_PORT} --vnc 127.0.0.1:${VNC_PORT}
EOF
chmod +x /usr/local/bin/lastb2b-gmail-ui-desktop.sh

cat >/usr/local/bin/lastb2b-gmail-ui-sync.sh <<EOF
#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f "${APP_ROOT}/package.json" ]]; then
  exit 0
fi

if [[ ! -d "${APP_ROOT}/node_modules" ]]; then
  exit 0
fi

if [[ ! -f "${APP_ROOT}/.env.local" ]]; then
  exit 0
fi

cd "${APP_ROOT}"
exec runuser -u "${APP_USER}" -- env \
  GMAIL_UI_PROFILE_ROOT="${DATA_ROOT}/gmail-ui-profiles" \
  GMAIL_UI_EXECUTABLE_PATH="/usr/bin/google-chrome-stable" \
  DISPLAY="${DISPLAY_NUM}" \
  npm run gmail-ui:normalize
EOF
chmod +x /usr/local/bin/lastb2b-gmail-ui-sync.sh

cat >/etc/systemd/system/lastb2b-gmail-ui-desktop.service <<EOF
[Unit]
Description=LastB2B Gmail UI desktop stack
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/lastb2b-gmail-ui-desktop.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/lastb2b-gmail-ui-sync.service <<EOF
[Unit]
Description=LastB2B Gmail UI sender normalization
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/lastb2b-gmail-ui-sync.sh
WorkingDirectory=${APP_ROOT}
StandardOutput=append:/var/log/lastb2b/gmail-ui-sync.log
StandardError=append:/var/log/lastb2b/gmail-ui-sync.log
EOF

cat >/etc/systemd/system/lastb2b-gmail-ui-sync.timer <<EOF
[Unit]
Description=Run LastB2B Gmail UI sender normalization every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=lastb2b-gmail-ui-sync.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now lastb2b-gmail-ui-desktop.service
systemctl enable --now lastb2b-gmail-ui-sync.timer

cat <<EOF
Bootstrap complete.

Next:
1. If the repo is not already in ${APP_ROOT}, copy or clone it there as ${APP_USER}.
2. Set GMAIL_UI_PROFILE_ROOT=${DATA_ROOT}/gmail-ui-profiles in .env.local.
3. Set GMAIL_UI_EXECUTABLE_PATH=/usr/bin/google-chrome-stable in .env.local.
4. Run npm install.
5. Run npx playwright install chromium.
6. The worker will auto-normalize Gmail UI senders every 5 minutes once node_modules and .env.local exist.
7. Tunnel noVNC over SSH: ssh -L ${NOVNC_PORT}:127.0.0.1:${NOVNC_PORT} USER@DROPLET
8. Open http://127.0.0.1:${NOVNC_PORT}/vnc.html locally.
EOF
