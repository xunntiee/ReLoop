import { readFileSync } from "node:fs";

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const build = read("../build-portable-mac.sh");
const start = read("../portable-mac/start-local-web.sh");
const stop = read("../portable-mac/stop-local-web.sh");
const open = read("../portable-mac/OPEN%20TOOL.command");
const workflow = read("../../.github/workflows/build-portable-macos.yml");
const browserLaunch = read(
  "../../apps/server/src/modules/crawl/browser-launch.ts"
);

const requiredChecks: [boolean, string][] = [
  [
    build.includes("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1") &&
      build.includes(
        "Portable ZIP unexpectedly contains a Playwright browser payload"
      ),
    "macOS build must keep Playwright while excluding bundled Chromium.",
  ],
  [
    build.includes('process.platform !== "darwin"') &&
      build.includes("process.arch !== process.argv[1]"),
    "macOS build must validate the bundled Node platform and architecture.",
  ],
  [
    build.includes("ffmpeg-static@5.3.0") &&
      build.includes("@derhuerst/ffprobe-static@5.3.0") &&
      build.includes('FFMPEG_ENCODERS="$(') &&
      build.includes('[[ "${FFMPEG_ENCODERS}" != *"libx264"* ]]') &&
      !build.includes("grep -q 'libx264'"),
    "macOS build must bundle self-contained FFmpeg binaries and verify H.264 rendering support.",
  ],
  [
    build.includes("ditto -c -k --sequesterRsrc --keepParent"),
    "macOS ZIP must preserve executable permissions.",
  ],
  [
    start.includes("/Applications/Google Chrome.app") &&
      start.includes("/Applications/Microsoft Edge.app"),
    "macOS launcher must fail early unless Chrome or Edge is installed.",
  ],
  [
    browserLaunch.includes(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ) &&
      browserLaunch.includes(
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      ),
    "Crawler browser resolution must support installed macOS Chrome and Edge.",
  ],
  [
    start.includes(`SERVER_CONFIG_PATH="\${CONFIG_PATH}"`) &&
      start.includes(`WEB_DIST_PATH="\${WEB_DIST_PATH}"`) &&
      start.includes(`TOOL_SHUTDOWN_TOKEN="\${SHUTDOWN_TOKEN}"`),
    "macOS launcher must pass persistent config, static web and shutdown token.",
  ],
  [
    start.includes(`is_managed_pid "\${pid}"`) &&
      stop.includes(`is_managed_pid "\${PID}"`),
    "Start and stop must only manage the bundled server process.",
  ],
  [
    stop.includes("/api/system/shutdown") &&
      stop.includes("x-tool-shutdown-token"),
    "macOS stop must request authenticated graceful shutdown.",
  ],
  [
    start.includes("acquire_lock") &&
      start.includes(`"\${LOCK_DIR}/owner.pid"`) &&
      stop.includes("acquire_lock") &&
      stop.includes(`"\${LOCK_DIR}/owner.pid"`),
    "macOS start and stop must share a recoverable atomic lifecycle lock.",
  ],
  [
    open.includes("_tool-runtime/start-local-web.sh"),
    "The user-facing macOS launcher must delegate to the runtime lifecycle script.",
  ],
  [
    workflow.includes("runner: macos-15") &&
      workflow.includes("runner: macos-15-intel") &&
      workflow.includes("scripts/build-portable-mac.sh") &&
      workflow.includes("actions/upload-artifact@v4"),
    "The manual release workflow must build both Apple Silicon and Intel ZIP artifacts.",
  ],
  [
    workflow.includes("run: bun install --no-save") &&
      !workflow.includes("--frozen-lockfile"),
    "The macOS workflow must allow platform-specific dependencies without rewriting the repository lockfile.",
  ],
];

for (const [ok, message] of requiredChecks) {
  if (!ok) {
    throw new Error(message);
  }
}

console.log("smoke:portable-mac-lifecycle ok");
