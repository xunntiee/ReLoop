#!/bin/bash

set -u

ZIP_PATH="${1:-}"
BUNDLE_PATH="${2:-}"
PORT="${3:-34577}"
UPDATES_ROOT="$(cd "$(dirname "${ZIP_PATH}")" && pwd -P)"
STAGE_PATH="${UPDATES_ROOT}/stage-$(date +%Y%m%d-%H%M%S)-$$"
BACKUP_PATH="${BUNDLE_PATH}.backup-$(date +%Y%m%d-%H%M%S)"
LOG_PATH="${UPDATES_ROOT}/updater.log"

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >>"${LOG_PATH}"
}

server_closed() {
  ! curl --connect-timeout 1 --max-time 2 --silent --fail "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1
}

server_healthy() {
  curl --connect-timeout 1 --max-time 2 --silent --fail "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '"status":"ok"'
}

start_tool() {
  open "${BUNDLE_PATH}/OPEN TOOL.command" >/dev/null 2>&1 || true
}

stop_tool() {
  open "${BUNDLE_PATH}/STOP TOOL.command" >/dev/null 2>&1 || true
  sleep 1
}

cleanup_failed() {
  rm -rf "${STAGE_PATH}" 2>/dev/null || true
}

if [[ -z "${ZIP_PATH}" || -z "${BUNDLE_PATH}" ]]; then
  log "Thieu tham so updater"
  exit 1
fi

trap cleanup_failed EXIT
log "Bat dau cap nhat tu ${ZIP_PATH}"
mkdir -p "${STAGE_PATH}" || exit 1
unzip -q "${ZIP_PATH}" -d "${STAGE_PATH}" || { log "Khong giai nen duoc ZIP"; exit 1; }

NEW_BUNDLE="${STAGE_PATH}/Tool Crawl to Video macOS-Apple-Silicon"
if [[ ! -d "${NEW_BUNDLE}" ]]; then
  NEW_BUNDLE="${STAGE_PATH}/Tool Crawl to Video macOS-Intel"
fi
if [[ ! -f "${NEW_BUNDLE}/_tool-runtime/build-manifest.json" || ! -f "${NEW_BUNDLE}/OPEN TOOL.command" ]]; then
  log "ZIP khong phai goi portable macOS hop le"
  exit 1
fi

DEADLINE=$((SECONDS + 45))
while ((SECONDS < DEADLINE)) && ! server_closed; do sleep 0.3; done
if ! server_closed; then
  log "Server cu chua dong hoan toan"
  exit 1
fi

mv "${BUNDLE_PATH}" "${BACKUP_PATH}" || { log "Khong backup duoc ban cu"; exit 1; }
if ! mv "${NEW_BUNDLE}" "${BUNDLE_PATH}"; then
  mv "${BACKUP_PATH}" "${BUNDLE_PATH}" 2>/dev/null || true
  log "Khong thay duoc bundle moi"
  start_tool
  exit 1
fi

chmod 755 "${BUNDLE_PATH}/OPEN TOOL.command" "${BUNDLE_PATH}/STOP TOOL.command" "${BUNDLE_PATH}/_tool-runtime/portable-updater.sh" "${BUNDLE_PATH}/_tool-runtime/start-local-web.sh" "${BUNDLE_PATH}/_tool-runtime/stop-local-web.sh" 2>/dev/null || true
start_tool

DEADLINE=$((SECONDS + 90))
while ((SECONDS < DEADLINE)) && ! server_healthy; do sleep 0.5; done
if ! server_healthy; then
  log "Ban moi khong khoi dong duoc, khoi phuc ban cu"
  stop_tool
  rm -rf "${BUNDLE_PATH}" 2>/dev/null || true
  mv "${BACKUP_PATH}" "${BUNDLE_PATH}" 2>/dev/null || true
  start_tool
  exit 1
fi

rm -f "${ZIP_PATH}"
rm -rf "${STAGE_PATH}"
trap - EXIT
log "Cap nhat thanh cong. Backup duoc giu tai ${BACKUP_PATH}"
