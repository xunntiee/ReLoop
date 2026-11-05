#!/bin/bash

set -u

RUNTIME_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
BUNDLE_ROOT="$(cd "${RUNTIME_ROOT}/.." && pwd -P)"
USER_DATA_ROOT="${HOME}/Library/Application Support/ToolBase"
LOGS_DIR="${USER_DATA_ROOT}/logs"
CONFIG_PATH="${USER_DATA_ROOT}/config.json"
PID_PATH="${LOGS_DIR}/local-web-server.pid"
TOKEN_PATH="${LOGS_DIR}/local-web-server.shutdown-token"
STDOUT_PATH="${LOGS_DIR}/server.out.log"
STDERR_PATH="${LOGS_DIR}/server.err.log"
LOCK_DIR="${LOGS_DIR}/launcher.lock"
NODE_PATH="${RUNTIME_ROOT}/node"
SERVER_ENTRY="${RUNTIME_ROOT}/server-dist/index.mjs"
WEB_DIST_PATH="${RUNTIME_ROOT}/web-dist"
FFMPEG_BIN_PATH="${RUNTIME_ROOT}/vendor/ffmpeg/bin"
CONFIG_EXAMPLE_PATH="${RUNTIME_ROOT}/config.example.json"

show_error() {
  local message="$1"
  mkdir -p "${LOGS_DIR}" 2>/dev/null || true
  printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "${message}" >>"${LOGS_DIR}/launcher-error.log"
  printf '\nLOI: %s\nChi tiet: %s\n' "${message}" "${LOGS_DIR}/launcher-error.log" >&2
  if command -v osascript >/dev/null 2>&1; then
    MESSAGE_FOR_DIALOG="${message}" osascript -e \
      'display alert "Post to Video khong the khoi dong" message (system attribute "MESSAGE_FOR_DIALOG") as critical' \
      >/dev/null 2>&1 || true
  fi
}

cleanup_lock() {
  local owner=""
  if [[ -f "${LOCK_DIR}/owner.pid" ]]; then
    owner="$(tr -dc '0-9' <"${LOCK_DIR}/owner.pid")"
  fi
  if [[ -z "${owner}" || "${owner}" == "$$" ]]; then
    rm -f "${LOCK_DIR}/owner.pid"
    rmdir "${LOCK_DIR}" 2>/dev/null || true
  fi
}

acquire_lock() {
  local owner=""
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    printf '%s' "$$" >"${LOCK_DIR}/owner.pid"
    return 0
  fi

  sleep 0.2
  if [[ -f "${LOCK_DIR}/owner.pid" ]]; then
    owner="$(tr -dc '0-9' <"${LOCK_DIR}/owner.pid")"
  fi
  if [[ -n "${owner}" ]] && kill -0 "${owner}" 2>/dev/null; then
    return 1
  fi

  rm -f "${LOCK_DIR}/owner.pid"
  rmdir "${LOCK_DIR}" 2>/dev/null || return 1
  mkdir "${LOCK_DIR}" 2>/dev/null || return 1
  printf '%s' "$$" >"${LOCK_DIR}/owner.pid"
}

fail() {
  show_error "$1"
  cleanup_lock
  exit 1
}

prepare_media_binary() {
  local binary_path="$1"
  local label="$2"

  [[ -f "${binary_path}" ]] || fail "Goi tool thieu ${label} cho macOS."

  if [[ ! -x "${binary_path}" ]]; then
    chmod u+x "${binary_path}" 2>/dev/null ||
      fail "Goi tool co ${label} nhung khong co quyen chay. Hay giai nen lai vao thu muc co quyen ghi."
  fi

  "${binary_path}" -version >/dev/null 2>&1 ||
    fail "${label} trong goi khong chay duoc tren may nay. Hay tai dung ban macOS Apple-Silicon hoac Intel."
}

find_system_browser() {
  local candidate
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "${HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "${HOME}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

read_port() {
  "${NODE_PATH}" -e '
    const fs = require("node:fs");
    try {
      const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const port = Number(config?.server?.port);
      process.stdout.write(String(Number.isInteger(port) && port > 0 ? port : 34577));
    } catch {
      process.stdout.write("34577");
    }
  ' "${CONFIG_PATH}"
}

server_is_healthy() {
  local port="$1"
  local response
  response="$(curl --connect-timeout 1 --max-time 2 --silent --fail \
    "http://127.0.0.1:${port}/api/health" 2>/dev/null)" || return 1
  [[ "${response}" == *'"service":"tool-base"'* && "${response}" == *'"status":"ok"'* ]]
}

is_managed_pid() {
  local pid="$1"
  local command_line
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
  kill -0 "${pid}" 2>/dev/null || return 1
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  [[ "${command_line}" == *"${NODE_PATH}"* && "${command_line}" == *"${SERVER_ENTRY}"* ]]
}

read_managed_pid() {
  local pid
  [[ -f "${PID_PATH}" ]] || return 1
  pid="$(tr -dc '0-9' <"${PID_PATH}")"
  if is_managed_pid "${pid}"; then
    printf '%s\n' "${pid}"
    return 0
  fi
  rm -f "${PID_PATH}"
  return 1
}

port_owner_pid() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || return 1
  lsof -n -P -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1
}

open_app() {
  local url="$1"
  if ! open "${url}" >/dev/null 2>&1; then
    printf 'Tool da san sang tai %s\n' "${url}"
  fi
}

mkdir -p "${USER_DATA_ROOT}" "${LOGS_DIR}" || {
  show_error "Khong tao duoc thu muc du lieu tai ${USER_DATA_ROOT}."
  exit 1
}

if ! acquire_lock; then
  fail "Tool dang duoc khoi dong hoac dung boi mot lenh khac. Hay doi 30 giay roi thu lai."
fi
trap cleanup_lock EXIT INT TERM

[[ -x "${NODE_PATH}" ]] || fail "Khong tim thay Node runtime dung cho macOS trong goi tool."
[[ -f "${SERVER_ENTRY}" ]] || fail "Goi tool thieu server-dist/index.mjs."
[[ -f "${WEB_DIST_PATH}/index.html" ]] || fail "Goi tool thieu giao dien web."
prepare_media_binary "${FFMPEG_BIN_PATH}/ffmpeg" "FFmpeg"
prepare_media_binary "${FFMPEG_BIN_PATH}/ffprobe" "FFprobe"
find_system_browser >/dev/null || fail "Khong tim thay Google Chrome hoac Microsoft Edge. Hay cai mot trong hai trinh duyet roi mo lai tool."

if [[ ! -f "${CONFIG_PATH}" ]]; then
  cp "${CONFIG_EXAMPLE_PATH}" "${CONFIG_PATH}" ||
    fail "Khong tao duoc file cau hinh tai ${CONFIG_PATH}."
fi

PORT="$(read_port)"
APP_URL="http://127.0.0.1:${PORT}/app"
MANAGED_PID="$(read_managed_pid || true)"

if server_is_healthy "${PORT}"; then
  if [[ -n "${MANAGED_PID}" ]]; then
    open_app "${APP_URL}"
    printf 'Tool da san sang tai %s\n' "${APP_URL}"
    exit 0
  fi
  fail "Port ${PORT} dang duoc mot ban Post to Video khac su dung. Hay tat ban local/dev hoac ban portable cu."
fi

if [[ -n "${MANAGED_PID}" ]]; then
  fail "Server portable PID ${MANAGED_PID} con chay nhung khong phan hoi. Hay mo STOP TOOL.command, sau do thu lai."
fi

OWNER_PID="$(port_owner_pid "${PORT}" || true)"
if [[ -n "${OWNER_PID}" ]]; then
  fail "Khong the khoi dong: port ${PORT} dang bi tien trinh ${OWNER_PID} su dung."
fi

SHUTDOWN_TOKEN="$("${NODE_PATH}" -e 'process.stdout.write(require("node:crypto").randomUUID().replaceAll("-", ""))')"
printf '%s' "${SHUTDOWN_TOKEN}" >"${TOKEN_PATH}"

env \
  SERVER_CONFIG_PATH="${CONFIG_PATH}" \
  TOOL_USER_DATA_ROOT="${USER_DATA_ROOT}" \
  WEB_DIST_PATH="${WEB_DIST_PATH}" \
  TOOL_BUNDLE_ROOT="${BUNDLE_ROOT}" \
  TOOL_UPDATE_SCRIPT="${RUNTIME_ROOT}/portable-updater.sh" \
  TOOL_SHUTDOWN_TOKEN="${SHUTDOWN_TOKEN}" \
  PATH="${FFMPEG_BIN_PATH}:${PATH}" \
  nohup "${NODE_PATH}" "${SERVER_ENTRY}" \
  >>"${STDOUT_PATH}" 2>>"${STDERR_PATH}" </dev/null &
SERVER_PID=$!
printf '%s' "${SERVER_PID}" >"${PID_PATH}"

DEADLINE=$((SECONDS + 90))
while ((SECONDS < DEADLINE)); do
  if server_is_healthy "${PORT}"; then
    open_app "${APP_URL}"
    printf 'Tool da san sang tai %s\n' "${APP_URL}"
    exit 0
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

rm -f "${PID_PATH}" "${TOKEN_PATH}"
fail "Khong the khoi dong tool. Xem log tai ${STDERR_PATH}."
