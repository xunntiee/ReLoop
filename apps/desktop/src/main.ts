import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";

const APP_NAME = "Post to Video";
const APP_ID = "com.toolbase.posttovideo";
const USER_DATA_DIR_NAME = "ToolBase";
const LEGACY_USER_DATA_DIR_NAME = "desktop";
const DEFAULT_PORT = 34577;
const SERVER_BOOT_TIMEOUT_MS = 90_000;
const SERVER_POLL_INTERVAL_MS = 500;
const SERVER_HEALTH_TIMEOUT_MS = 2_000;

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(moduleDir, "..", "..", "..");

type RuntimePaths = {
  configPath: string;
  exampleConfigPath: string;
  logsDir: string;
  resourcesRoot: string;
  serverEntryPath: string;
  stderrLogPath: string;
  stdoutLogPath: string;
  userDataRoot: string;
  webDistPath: string;
};

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverOwnedByDesktop = false;
let shutdownStarted = false;
let serverShutdownToken: string | null = null;

app.setAppUserModelId(APP_ID);
app.setPath("userData", join(app.getPath("appData"), USER_DATA_DIR_NAME));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktopApp).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(APP_NAME, message);
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shutdownStarted || !serverProcess || !serverOwnedByDesktop) {
    return;
  }

  event.preventDefault();
  shutdownStarted = true;
  void stopServer().finally(() => {
    app.quit();
  });
});

async function startDesktopApp(): Promise<void> {
  const runtime = ensureRuntimePaths();
  mainWindow = createMainWindow();
  await mainWindow.loadURL(toDataUrl(buildLoadingHtml()));

  const serverReady = await ensureServer(runtime);
  if (!serverReady.ok) {
    const errorHtml = buildErrorHtml(serverReady.message, runtime);
    await mainWindow.loadURL(toDataUrl(errorHtml));
    return;
  }

  await mainWindow.loadURL(buildAppUrl());
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    minHeight: 860,
    minWidth: 1360,
    backgroundColor: "#0f1115",
    show: true,
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return window;
}

function ensureRuntimePaths(): RuntimePaths {
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : repoRoot;
  const userDataRoot = app.getPath("userData");
  const legacyUserDataRoot = join(app.getPath("appData"), LEGACY_USER_DATA_DIR_NAME);
  const exampleConfigPath = join(resourcesRoot, "config.example.json");
  const configPath = join(userDataRoot, "config.json");
  const logsDir = join(userDataRoot, "logs");

  migrateLegacyUserData(legacyUserDataRoot, userDataRoot);
  mkdirSync(userDataRoot, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  if (!existsSync(configPath)) {
    copyFileSync(exampleConfigPath, configPath);
  }

  migrateBrowserChannelPreference(configPath);

  return {
    configPath,
    exampleConfigPath,
    logsDir,
    resourcesRoot,
    serverEntryPath: app.isPackaged
      ? join(resourcesRoot, "server-dist", "index.mjs")
      : join(repoRoot, "apps", "server", "dist", "index.mjs"),
    stderrLogPath: join(logsDir, "server.err.log"),
    stdoutLogPath: join(logsDir, "server.out.log"),
    userDataRoot,
    webDistPath: app.isPackaged
      ? join(resourcesRoot, "web-dist")
      : join(repoRoot, "apps", "web", "dist"),
  };
}

function migrateBrowserChannelPreference(configPath: string): void {
  if (!existsSync(configPath)) {
    return;
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as {
      crawl?: {
        browserChannel?: string;
        executablePath?: string;
      };
    };

    if (!parsed.crawl) {
      return;
    }

    const currentChannel = String(parsed.crawl.browserChannel ?? "").trim().toLowerCase();
    const executablePath = String(parsed.crawl.executablePath ?? "").trim();

    if (currentChannel !== "msedge" || executablePath) {
      return;
    }

    parsed.crawl.browserChannel = "chrome";
    writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    // Keep startup resilient even if a user-edited config is malformed.
  }
}

function migrateLegacyUserData(legacyRoot: string, targetRoot: string): void {
  if (!legacyRoot || legacyRoot === targetRoot || !existsSync(legacyRoot)) {
    return;
  }

  mkdirSync(targetRoot, { recursive: true });

  copyLegacyEntry(legacyRoot, targetRoot, "config.json");
  copyLegacyEntry(legacyRoot, targetRoot, "data");
  copyLegacyEntry(legacyRoot, targetRoot, "logs");
}

function copyLegacyEntry(legacyRoot: string, targetRoot: string, entryName: string): void {
  const sourcePath = join(legacyRoot, entryName);
  const targetPath = join(targetRoot, entryName);

  if (!existsSync(sourcePath) || existsSync(targetPath)) {
    return;
  }

  cpSync(sourcePath, targetPath, { recursive: true });
}

async function ensureServer(
  runtime: RuntimePaths,
): Promise<{ ok: true } | { message: string; ok: false }> {
  if (await isServerHealthy()) {
    return { ok: true };
  }

  try {
    spawnServer(runtime);
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }

  const deadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isServerHealthy()) {
      return { ok: true };
    }
    await delay(SERVER_POLL_INTERVAL_MS);
  }

  return {
    message: "Không thể khởi động server local trong thời gian chờ.",
    ok: false,
  };
}

function spawnServer(runtime: RuntimePaths): void {
  if (serverProcess) {
    return;
  }

  if (!existsSync(runtime.serverEntryPath)) {
    throw new Error(`Không tìm thấy server entry: ${runtime.serverEntryPath}`);
  }

  if (!existsSync(runtime.webDistPath)) {
    throw new Error(`Không tìm thấy web build: ${runtime.webDistPath}`);
  }

  const shutdownToken = randomUUID().replaceAll("-", "");
  const outFd = openSync(runtime.stdoutLogPath, "a");
  const errFd = openSync(runtime.stderrLogPath, "a");

  const child = spawn(process.execPath, [runtime.serverEntryPath], {
    cwd: dirname(runtime.serverEntryPath),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SERVER_CONFIG_PATH: runtime.configPath,
      TOOL_SHUTDOWN_TOKEN: shutdownToken,
      WEB_DIST_PATH: runtime.webDistPath,
    },
    stdio: ["ignore", outFd, errFd],
    windowsHide: true,
  });

  closeSync(outFd);
  closeSync(errFd);

  serverProcess = child;
  serverOwnedByDesktop = true;
  serverShutdownToken = shutdownToken;

  child.once("exit", (code, signal) => {
    const exitedDuringShutdown = shutdownStarted;
    serverProcess = null;
    serverOwnedByDesktop = false;
    serverShutdownToken = null;

    if (exitedDuringShutdown || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const message =
      code === 0
        ? "Server đã dừng."
        : `Server dừng đột ngột. Exit code: ${String(code ?? "null")}, signal: ${String(signal ?? "null")}`;

    void mainWindow.loadURL(
      toDataUrl(
        buildErrorHtml(message, runtime),
      ),
    );
  });
}

async function stopServer(): Promise<void> {
  const child = serverProcess;
  const token = serverShutdownToken;
  if (!child || !serverOwnedByDesktop) {
    serverProcess = null;
    serverOwnedByDesktop = false;
    serverShutdownToken = null;
    return;
  }

  const pid = child.pid;
  serverProcess = null;
  serverOwnedByDesktop = false;
  serverShutdownToken = null;

  if (!pid) {
    return;
  }

  let gracefulRequested = false;
  if (token) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/api/system/shutdown`, {
        headers: { "x-tool-shutdown-token": token },
        method: "POST",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) {
        gracefulRequested = true;
      }
    } catch {
      // Endpoint shutdown request failed, proceed to fallback signal.
    }
  }

  if (!gracefulRequested && process.platform !== "win32") {
    try {
      child.kill("SIGTERM");
      gracefulRequested = true;
    } catch {
      // Signal send failed, proceed to fallback kill.
    }
  }

  const exitedGracefully = await waitForChildExit(child, gracefulRequested ? 5_000 : 1_000);

  if (!exitedGracefully) {
    if (process.platform === "win32") {
      try {
        await spawnAndWait("taskkill", ["/pid", String(pid), "/t", "/f"]);
      } catch {
        // Child already exited or process not found.
      }
    } else {
      try {
        child.kill("SIGKILL");
      } catch {
        // Child already exited.
      }
    }
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | null = null;

    const onExit = () => {
      if (timer) clearTimeout(timer);
      resolve(true);
    };

    child.once("exit", onExit);

    timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(child.exitCode !== null);
    }, timeoutMs);
  });
}

async function isServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch(buildHealthUrl(), {
      signal: AbortSignal.timeout(SERVER_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { service?: string; status?: string };
    return payload.service === "tool-base" && payload.status === "ok";
  } catch {
    return false;
  }
}

async function spawnAndWait(
  command: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}

function buildAppUrl(): string {
  return `http://127.0.0.1:${DEFAULT_PORT}/app`;
}

function buildHealthUrl(): string {
  return `http://127.0.0.1:${DEFAULT_PORT}/api/health`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function buildLoadingHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(APP_NAME)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f1115;
        color: #f5f7fb;
        font: 16px/1.5 "Segoe UI", Arial, sans-serif;
      }
      .card {
        width: min(560px, calc(100vw - 48px));
        padding: 32px;
        border-radius: 20px;
        background: rgba(20, 24, 31, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0; color: rgba(255,255,255,0.72); }
      .hint { margin-top: 12px; font-size: 14px; color: rgba(255,255,255,0.58); }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Đang mở ${escapeHtml(APP_NAME)}</h1>
      <p>Desktop đang khởi động server local và nạp giao diện...</p>
      <p class="hint">Lần đầu có thể mất 30-90 giây. Không cần đóng cửa sổ này.</p>
    </div>
  </body>
</html>`;
}

function buildErrorHtml(message: string, runtime: RuntimePaths): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(APP_NAME)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #12151b;
        color: #f7f8fb;
        font: 16px/1.5 "Segoe UI", Arial, sans-serif;
      }
      .card {
        width: min(720px, calc(100vw - 48px));
        padding: 32px;
        border-radius: 20px;
        background: rgba(19, 23, 30, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p, li { color: rgba(255,255,255,0.8); }
      ul { padding-left: 20px; }
      code {
        display: inline-block;
        margin-top: 6px;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.08);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Không thể mở ${escapeHtml(APP_NAME)}</h1>
      <p>${escapeHtml(message)}</p>
      <ul>
        <li>Config: <code>${escapeHtml(runtime.configPath)}</code></li>
        <li>Stdout log: <code>${escapeHtml(runtime.stdoutLogPath)}</code></li>
        <li>Stderr log: <code>${escapeHtml(runtime.stderrLogPath)}</code></li>
      </ul>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
