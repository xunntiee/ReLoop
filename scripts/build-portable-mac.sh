#!/bin/bash

set -euo pipefail

RELEASE_LABEL="${1:-v1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
HOST_MACHINE="$(uname -m)"

case "${HOST_MACHINE}" in
  arm64) TARGET_ARCH="arm64" ;;
  x86_64) TARGET_ARCH="x64" ;;
  *)
    printf 'Unsupported macOS architecture: %s\n' "${HOST_MACHINE}" >&2
    exit 1
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'build-portable-mac.sh must run on macOS.\n' >&2
  exit 1
fi

write_step() {
  printf '==> %s\n' "$1"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing build command: %s\n' "$1" >&2
    exit 1
  }
}

require_command bun
require_command node
require_command npm
require_command curl
require_command ditto
require_command unzip
require_command file
require_command grep

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
NODE_ARCH="$(node -p 'process.arch')"
NODE_VERSION="$(node -p 'process.version')"
if ((NODE_MAJOR < 20)); then
  printf 'Node.js 20 or newer is required on the build Mac.\n' >&2
  exit 1
fi
if [[ "${NODE_ARCH}" != "${TARGET_ARCH}" ]]; then
  printf 'Node architecture %s does not match host target %s.\n' "${NODE_ARCH}" "${TARGET_ARCH}" >&2
  exit 1
fi

assert_binary_architecture() {
  local binary_path="$1"
  local label="$2"
  local description
  description="$(file "${binary_path}")"
  if [[ "${TARGET_ARCH}" == "arm64" && "${description}" != *"arm64"* ]]; then
    printf '%s is not an arm64 macOS binary: %s\n' "${label}" "${description}" >&2
    exit 1
  fi
  if [[ "${TARGET_ARCH}" == "x64" && "${description}" != *"x86_64"* ]]; then
    printf '%s is not an x64 macOS binary: %s\n' "${label}" "${description}" >&2
    exit 1
  fi
}

STAMP="$(date '+%Y%m%d-%H%M%S')"
RUNTIME_WORKDIR="${ROOT}/.local-web-runtime-macos-${TARGET_ARCH}"
MEDIA_RUNTIME_WORKDIR="${RUNTIME_WORKDIR}/media-runtime"
RELEASE_BASE="${ROOT}/release"
PLATFORM_LABEL="macOS-Apple-Silicon"
if [[ "${TARGET_ARCH}" == "x64" ]]; then
  PLATFORM_LABEL="macOS-Intel"
fi
BUNDLE_NAME="Tool Crawl to Video ${PLATFORM_LABEL}"
BUNDLE_ROOT="${RELEASE_BASE}/${BUNDLE_NAME}"
RUNTIME_BUNDLE_ROOT="${BUNDLE_ROOT}/_tool-runtime"
ZIP_PATH="${RELEASE_BASE}/ToolCrawlToVideo-${PLATFORM_LABEL}-${RELEASE_LABEL}-${STAMP}.zip"
NODE_ARCHIVE="${RUNTIME_WORKDIR}/node-${NODE_VERSION}-darwin-${TARGET_ARCH}.tar.gz"
NODE_EXTRACT_DIR="${RUNTIME_WORKDIR}/node-runtime"
NODE_DOWNLOAD_ARCH="${TARGET_ARCH}"

write_step "Building workspace"
(
  cd "${ROOT}"
  bun run build
)

write_step "Preparing macOS runtime dependencies"
rm -rf "${RUNTIME_WORKDIR}"
mkdir -p "${RUNTIME_WORKDIR}"
node "${SCRIPT_DIR}/build-portable-runtime-package.mjs" \
  "${ROOT}/package.json" \
  "${ROOT}/apps/server/package.json" \
  "${RUNTIME_WORKDIR}/package.json"
(
  cd "${RUNTIME_WORKDIR}"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm install --omit=dev --no-package-lock
)

if [[ -n "${FFMPEG_PATH:-}" || -n "${FFPROBE_PATH:-}" ]]; then
  if [[ ! -x "${FFMPEG_PATH:-}" || ! -x "${FFPROBE_PATH:-}" ]]; then
    printf 'FFMPEG_PATH and FFPROBE_PATH must both point to executable macOS binaries.\n' >&2
    exit 1
  fi
  FFMPEG_SOURCE="${FFMPEG_PATH}"
  FFPROBE_SOURCE="${FFPROBE_PATH}"
  FFMPEG_LICENSE_SOURCE=""
  FFPROBE_LICENSE_SOURCE=""
else
  write_step "Downloading self-contained FFmpeg 6.1.1 binaries for macOS"
  mkdir -p "${MEDIA_RUNTIME_WORKDIR}"
  npm install \
    --prefix "${MEDIA_RUNTIME_WORKDIR}" \
    --no-package-lock \
    --no-save \
    --omit=dev \
    ffmpeg-static@5.3.0 \
    @derhuerst/ffprobe-static@5.3.0
  FFMPEG_SOURCE="$(cd "${MEDIA_RUNTIME_WORKDIR}" && node -p 'require("ffmpeg-static")')"
  FFPROBE_SOURCE="$(cd "${MEDIA_RUNTIME_WORKDIR}" && node -p 'require("@derhuerst/ffprobe-static")')"
  FFMPEG_LICENSE_SOURCE="${MEDIA_RUNTIME_WORKDIR}/node_modules/ffmpeg-static/LICENSE"
  FFPROBE_LICENSE_SOURCE="${MEDIA_RUNTIME_WORKDIR}/node_modules/@derhuerst/ffprobe-static/LICENSE"
fi

assert_binary_architecture "${FFMPEG_SOURCE}" "FFmpeg"
assert_binary_architecture "${FFPROBE_SOURCE}" "FFprobe"

write_step "Downloading official Node.js runtime ${NODE_VERSION} for darwin-${NODE_DOWNLOAD_ARCH}"
curl --fail --location --retry 3 \
  "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-${NODE_DOWNLOAD_ARCH}.tar.gz" \
  --output "${NODE_ARCHIVE}"
mkdir -p "${NODE_EXTRACT_DIR}"
tar -xzf "${NODE_ARCHIVE}" -C "${NODE_EXTRACT_DIR}" --strip-components=1

write_step "Preparing portable macOS folder"
rm -rf "${BUNDLE_ROOT}"
mkdir -p "${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/bin"
cp -R "${ROOT}/apps/server/dist" "${RUNTIME_BUNDLE_ROOT}/server-dist"
cp -R "${ROOT}/apps/web/dist" "${RUNTIME_BUNDLE_ROOT}/web-dist"
cp -R "${RUNTIME_WORKDIR}/node_modules" "${RUNTIME_BUNDLE_ROOT}/node_modules"
cp "${ROOT}/config.example.json" "${RUNTIME_BUNDLE_ROOT}/config.example.json"
cp "${SCRIPT_DIR}/portable-mac/portable-updater.sh" "${RUNTIME_BUNDLE_ROOT}/portable-updater.sh"
cp "${NODE_EXTRACT_DIR}/bin/node" "${RUNTIME_BUNDLE_ROOT}/node"
cp "${FFMPEG_SOURCE}" "${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/bin/ffmpeg"
cp "${FFPROBE_SOURCE}" "${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/bin/ffprobe"
if [[ -f "${FFMPEG_LICENSE_SOURCE}" ]]; then
  cp "${FFMPEG_LICENSE_SOURCE}" "${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/LICENSE-ffmpeg-static.txt"
fi
if [[ -f "${FFPROBE_LICENSE_SOURCE}" ]]; then
  cp "${FFPROBE_LICENSE_SOURCE}" "${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/LICENSE-ffprobe-static.txt"
fi
cp "${SCRIPT_DIR}/portable-mac/start-local-web.sh" "${RUNTIME_BUNDLE_ROOT}/start-local-web.sh"
cp "${SCRIPT_DIR}/portable-mac/stop-local-web.sh" "${RUNTIME_BUNDLE_ROOT}/stop-local-web.sh"
cp "${SCRIPT_DIR}/portable-mac/OPEN TOOL.command" "${BUNDLE_ROOT}/OPEN TOOL.command"
cp "${SCRIPT_DIR}/portable-mac/STOP TOOL.command" "${BUNDLE_ROOT}/STOP TOOL.command"
cp "${SCRIPT_DIR}/HUONG_DAN_TOOL_MAC.txt" "${BUNDLE_ROOT}/HUONG_DAN_TOOL_MAC.txt"

chmod 755 \
  "${RUNTIME_BUNDLE_ROOT}/node" \
  "${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/bin/ffmpeg" \
  "${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/bin/ffprobe" \
  "${RUNTIME_BUNDLE_ROOT}/start-local-web.sh" \
  "${RUNTIME_BUNDLE_ROOT}/stop-local-web.sh" \
  "${RUNTIME_BUNDLE_ROOT}/portable-updater.sh" \
  "${BUNDLE_ROOT}/OPEN TOOL.command" \
  "${BUNDLE_ROOT}/STOP TOOL.command"

BUILT_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
cat >"${RUNTIME_BUNDLE_ROOT}/build-manifest.json" <<EOF
{
  "appName": "Post to Video",
  "builtAt": "${BUILT_AT}",
  "buildMode": "local-web-bundle-macos",
  "platform": "darwin",
  "architecture": "${TARGET_ARCH}",
  "runtimeRoot": "_tool-runtime",
  "nodeExecutable": "_tool-runtime/node",
  "browserPriority": ["chrome", "msedge"],
  "browserRequirement": "Google Chrome or Microsoft Edge must be installed",
  "openScript": "OPEN TOOL.command",
  "stopScript": "STOP TOOL.command",
  "serverEntry": "_tool-runtime/server-dist/index.mjs",
  "webEntry": "_tool-runtime/web-dist/index.html",
  "version": "${RELEASE_LABEL}",
  "releaseLabel": "${RELEASE_LABEL}"
}
EOF

write_step "Validating bundled executables"
"${RUNTIME_BUNDLE_ROOT}/node" -e \
  'if (process.platform !== "darwin" || process.arch !== process.argv[1]) process.exit(1)' \
  "${TARGET_ARCH}"
"${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/bin/ffmpeg" -version >/dev/null
"${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/bin/ffprobe" -version >/dev/null
if ! FFMPEG_ENCODERS="$(
  "${RUNTIME_BUNDLE_ROOT}/vendor/ffmpeg/bin/ffmpeg" -hide_banner -encoders 2>/dev/null
)"; then
  printf 'Unable to inspect encoders from the bundled FFmpeg binary.\n' >&2
  exit 1
fi
if [[ "${FFMPEG_ENCODERS}" != *"libx264"* ]]; then
  printf 'Bundled FFmpeg does not provide the libx264 encoder required by video rendering.\n' >&2
  exit 1
fi

write_step "Creating macOS ZIP archive"
rm -f "${ZIP_PATH}"
ditto -c -k --sequesterRsrc --keepParent "${BUNDLE_ROOT}" "${ZIP_PATH}"

write_step "Validating macOS ZIP archive"
ARCHIVE_ENTRIES="$(unzip -Z1 "${ZIP_PATH}")"
for required_entry in \
  "${BUNDLE_NAME}/OPEN TOOL.command" \
  "${BUNDLE_NAME}/STOP TOOL.command" \
  "${BUNDLE_NAME}/_tool-runtime/portable-updater.sh" \
  "${BUNDLE_NAME}/_tool-runtime/node" \
  "${BUNDLE_NAME}/_tool-runtime/server-dist/index.mjs" \
  "${BUNDLE_NAME}/_tool-runtime/web-dist/index.html" \
  "${BUNDLE_NAME}/_tool-runtime/vendor/ffmpeg/bin/ffmpeg" \
  "${BUNDLE_NAME}/_tool-runtime/vendor/ffmpeg/bin/ffprobe"; do
  if ! grep -Fqx "${required_entry}" <<<"${ARCHIVE_ENTRIES}"; then
    rm -f "${ZIP_PATH}"
    printf 'Portable ZIP is missing: %s\n' "${required_entry}" >&2
    exit 1
  fi
done

ARCHIVE_CHECK_DIR="${RUNTIME_WORKDIR}/archive-check"
rm -rf "${ARCHIVE_CHECK_DIR}"
mkdir -p "${ARCHIVE_CHECK_DIR}"
ditto -x -k "${ZIP_PATH}" "${ARCHIVE_CHECK_DIR}"
for executable_entry in \
  "${BUNDLE_NAME}/_tool-runtime/node" \
  "${BUNDLE_NAME}/_tool-runtime/vendor/ffmpeg/bin/ffmpeg" \
  "${BUNDLE_NAME}/_tool-runtime/vendor/ffmpeg/bin/ffprobe" \
  "${BUNDLE_NAME}/_tool-runtime/start-local-web.sh"; do
  if [[ ! -x "${ARCHIVE_CHECK_DIR}/${executable_entry}" ]]; then
    rm -f "${ZIP_PATH}"
    printf 'Portable ZIP lost executable permission on: %s\n' "${executable_entry}" >&2
    exit 1
  fi
done

if grep -Eiq '(^|/)(ms-playwright|chromium_headless_shell-[^/]+|chromium-[0-9]+)(/|$)' <<<"${ARCHIVE_ENTRIES}"; then
  rm -f "${ZIP_PATH}"
  printf 'Portable ZIP unexpectedly contains a Playwright browser payload.\n' >&2
  exit 1
fi

write_step "macOS portable ready at ${ZIP_PATH}"
