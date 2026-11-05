#!/bin/bash

set -u

RUNTIME_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
USER_DATA_ROOT="${HOME}/Library/Application Support/ToolBase"
LOGS_DIR="${USER_DATA_ROOT}/logs"
CONFIG_PATH="${USER_DATA_ROOT}/config.json"
PID_PATH="${LOGS_DIR}/local-web-server.pid"
TOKEN_PATH="${LOGS_DIR}/local-web-server.shutdown-token"
LOCK_DIR="${LOGS_DIR}/launcher.lock"
NODE_PATH="${RUNTIME_ROOT}/node"
SERVER_ENTRY="${RUNTIME_ROOT}/server-dist/index.mjs"

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

is_managed_pid() {
  local pid="$1"
  local command_line
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
  kill -0 "${pid}" 2>/dev/null || return 1
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  [[ "${command_line}" == *"${NODE_PATH}"* && "${command_line}" == *"${SERVER_ENTRY}"* ]]
}

kill_children() {
  local parent_pid="$1"
  local child_pid
  for child_pid in $(pgrep -P "${parent_pid}" 2>/dev/null || true); do
    kill_children "${child_pid}"
    kill -TERM "${child_pid}" 2>/dev/null || true
  done
}

mkdir -p "${LOGS_DIR}"
if ! acquire_lock; then
  printf 'Tool dang khoi dong hoac mot lenh STOP khac dang chay. Hay thu lai sau.\n' >&2
  exit 1
fi
trap cleanup_lock EXIT INT TERM

PID=""
if [[ -f "${PID_PATH}" ]]; then
  CANDIDATE_PID="$(tr -dc '0-9' <"${PID_PATH}")"
  if is_managed_pid "${CANDIDATE_PID}"; then
    PID="${CANDIDATE_PID}"
  fi
fi

if [[ -z "${PID}" ]]; then
  rm -f "${PID_PATH}" "${TOKEN_PATH}"
  printf 'Khong co server portable nao dang chay.\n'
  exit 0
fi

PORT="$(read_port)"
SHUTDOWN_REQUESTED=0
if [[ -s "${TOKEN_PATH}" ]]; then
  TOKEN="$(tr -d '\r\n' <"${TOKEN_PATH}")"
  if curl --connect-timeout 2 --max-time 5 --silent --fail \
    -X POST \
    -H "x-tool-shutdown-token: ${TOKEN}" \
    "http://127.0.0.1:${PORT}/api/system/shutdown" >/dev/null 2>&1; then
    SHUTDOWN_REQUESTED=1
    printf 'Dang luu tien do va dung an toan...\n'
  fi
fi

if ((SHUTDOWN_REQUESTED == 1)); then
  WAIT_SECONDS=25
else
  WAIT_SECONDS=3
fi

DEADLINE=$((SECONDS + WAIT_SECONDS))
while ((SECONDS < DEADLINE)); do
  if ! kill -0 "${PID}" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

if is_managed_pid "${PID}"; then
  printf 'Tool chua dung het sau thoi gian cho. Dang tat cac tien trinh con...\n'
  kill_children "${PID}"
  kill -TERM "${PID}" 2>/dev/null || true
  sleep 1
  if is_managed_pid "${PID}"; then
    for child_pid in $(pgrep -P "${PID}" 2>/dev/null || true); do
      kill -KILL "${child_pid}" 2>/dev/null || true
    done
    kill -KILL "${PID}" 2>/dev/null || true
  fi
fi

rm -f "${PID_PATH}" "${TOKEN_PATH}"
printf 'Da tat Post to Video.\n'
