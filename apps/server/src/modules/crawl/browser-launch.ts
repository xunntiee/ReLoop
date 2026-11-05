import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BrowserLaunchOptions = {
  args?: string[];
  channel?: string;
  executablePath?: string;
  headless?: boolean;
  timeout?: number;
};

type LaunchedBrowser = {
  close(): Promise<void>;
};

type ChromiumLauncher = {
  launch(options?: BrowserLaunchOptions): Promise<LaunchedBrowser>;
};

export type ChromiumLaunchHealth = {
  attemptedAt: string;
  attempts?: ChromiumLaunchAttempt[];
  browserTarget: string;
  durationMs: number;
  error?: string;
  errorCode?:
    | "devtools_attach_timeout"
    | "missing_browser"
    | "launch_timeout"
    | "launch_failed";
  mode: "headless" | "headed";
  ok: boolean;
  recommendations: string[];
  requestedOptions: BrowserLaunchOptions;
  resolvedOptions: BrowserLaunchOptions;
  summary: string;
};

export type ChromiumLaunchAttempt = {
  browserTarget: string;
  durationMs: number;
  error?: string;
  errorCode?: ChromiumLaunchHealth["errorCode"];
  ok: boolean;
  resolvedOptions: BrowserLaunchOptions;
};

const DEFAULT_BROWSER_CHANNELS = ["chrome", "msedge"];
const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const MAX_SYSTEM_BROWSER_PROBE_TIMEOUT_MS = 15_000;
const SYSTEM_BROWSER_REQUIRED_SUMMARY =
  "Không tìm thấy Google Chrome hoặc Microsoft Edge. Hãy cài đặt hoặc cập nhật một trong hai trình duyệt rồi mở lại tool.";
const WINDOWS_REGISTRY_PATH_PATTERN = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im;
const launchResolutionCache = new Map<string, Promise<BrowserLaunchOptions>>();
const launchHealthCache = new Map<string, Promise<ChromiumLaunchHealth>>();
const registryBrowserPathCache = new Map<string, string[]>();

export async function resolveChromiumLaunchOptions(
  chromium: ChromiumLauncher,
  options: BrowserLaunchOptions,
): Promise<BrowserLaunchOptions> {
  void chromium;

  const executablePath = String(options.executablePath ?? "").trim();
  if (executablePath) {
    return {
      ...options,
      channel: undefined,
      executablePath,
    };
  }



  const preferredChannel = normalizeChannel(String(options.channel ?? ""));
  const cacheKey = preferredChannel || "auto";
  const cached = launchResolutionCache.get(cacheKey);
  if (cached) {
    const resolved = await cached;
    return { ...options, ...resolved };
  }

  const resolutionPromise = Promise.resolve(resolveInstalledBrowserChannel(preferredChannel));
  launchResolutionCache.set(cacheKey, resolutionPromise);

  try {
    const resolved = await resolutionPromise;
    return { ...options, ...resolved };
  } catch (error) {
    launchResolutionCache.delete(cacheKey);
    throw error;
  }
}

export async function getChromiumLaunchHealth(
  chromium: ChromiumLauncher,
  options: BrowserLaunchOptions,
): Promise<ChromiumLaunchHealth> {
  const normalizedOptions = normalizeRequestedLaunchOptions(options);
  const cacheKey = JSON.stringify({
    channel: String(normalizedOptions.channel ?? ""),
    executablePath: String(normalizedOptions.executablePath ?? ""),
    headless: isHeadlessModeRequested(normalizedOptions),
    timeout: Number(normalizedOptions.timeout ?? 0),
  });
  const cached = launchHealthCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const healthPromise = probeChromiumLaunchHealthWithFallback(chromium, normalizedOptions);
  launchHealthCache.set(cacheKey, healthPromise);

  try {
    const health = await healthPromise;
    if (!health.ok) {
      launchHealthCache.delete(cacheKey);
    }
    return health;
  } catch (error) {
    launchHealthCache.delete(cacheKey);
    throw error;
  }
}

export async function ensureChromiumLaunchHealthy(
  chromium: ChromiumLauncher,
  options: BrowserLaunchOptions,
): Promise<BrowserLaunchOptions> {
  const health = await getChromiumLaunchHealth(chromium, options);
  if (!health.ok) {
    throw new Error(health.summary);
  }
  return health.resolvedOptions;
}

function resolveInstalledBrowserChannel(preferredChannel: string): BrowserLaunchOptions {
  const channels = buildChannelCandidates(preferredChannel);

  for (const channel of channels) {
    if (isBrowserChannelInstalled(channel)) {
      return { channel };
    }
  }

  throw new Error(SYSTEM_BROWSER_REQUIRED_SUMMARY);
}

async function probeChromiumLaunchHealthWithFallback(
  chromium: ChromiumLauncher,
  requestedOptions: BrowserLaunchOptions,
): Promise<ChromiumLaunchHealth> {
  const candidates = buildHealthProbeCandidates(requestedOptions);
  const attempts: ChromiumLaunchAttempt[] = [];
  let lastHealth: ChromiumLaunchHealth | null = null;

  for (const candidate of candidates) {
    const health = await probeChromiumLaunchHealth(chromium, requestedOptions, candidate);
    attempts.push({
      browserTarget: health.browserTarget,
      durationMs: health.durationMs,
      error: health.error,
      errorCode: health.errorCode,
      ok: health.ok,
      resolvedOptions: health.resolvedOptions,
    });
    lastHealth = health;

    if (health.ok) {
      return finalizeLaunchHealth(health, attempts);
    }
    if (!shouldTryNextLaunchCandidate(requestedOptions, attempts, candidates.length)) {
      return finalizeLaunchHealth(health, attempts);
    }
  }

  return finalizeLaunchHealth(
    lastHealth ??
      {
        attemptedAt: new Date().toISOString(),
        browserTarget: describeBrowserTarget(requestedOptions),
        durationMs: 0,
        error: "No browser launch candidates available.",
        errorCode: "missing_browser",
        mode: isHeadlessModeRequested(requestedOptions) ? "headless" : "headed",
        ok: false,
        recommendations: buildLaunchRecommendations("missing_browser", requestedOptions),
        requestedOptions,
        resolvedOptions: requestedOptions,
        summary: SYSTEM_BROWSER_REQUIRED_SUMMARY,
      },
    attempts,
  );
}

async function probeChromiumLaunchHealth(
  chromium: ChromiumLauncher,
  requestedOptions: BrowserLaunchOptions,
  resolvedOptions: BrowserLaunchOptions,
): Promise<ChromiumLaunchHealth> {
  const startedAt = Date.now();
  const mode = resolvedOptions.headless === false ? "headed" : "headless";
  const timeout = Math.max(
    3_000,
    Math.min(
      Number(resolvedOptions.timeout ?? requestedOptions.timeout ?? DEFAULT_HEALTH_TIMEOUT_MS) || DEFAULT_HEALTH_TIMEOUT_MS,
      MAX_SYSTEM_BROWSER_PROBE_TIMEOUT_MS,
    ),
  );

  try {
    const browser = await chromium.launch({
      ...resolvedOptions,
      timeout,
    });
    await browser.close().catch(() => undefined);
    return {
      attemptedAt: new Date(startedAt).toISOString(),
      browserTarget: describeBrowserTarget(resolvedOptions),
      durationMs: Date.now() - startedAt,
      mode,
      ok: true,
      recommendations: [],
      requestedOptions: requestedOptions,
      resolvedOptions,
      summary:
        mode === "headless"
          ? `Headless crawl browser khởi động bình thường bằng ${describeBrowserTarget(resolvedOptions)}.`
          : `Browser đăng nhập khởi động bình thường bằng ${describeBrowserTarget(resolvedOptions)}.`,
    };
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);
    const errorCode = classifyLaunchError(errorMessage, resolvedOptions);
    return {
      attemptedAt: new Date(startedAt).toISOString(),
      browserTarget: describeBrowserTarget(resolvedOptions),
      durationMs: Date.now() - startedAt,
      error: errorMessage,
      errorCode,
      mode,
      ok: false,
      recommendations: buildLaunchRecommendations(errorCode, resolvedOptions),
      requestedOptions,
      resolvedOptions,
      summary: buildLaunchSummary(errorCode, resolvedOptions, Date.now() - startedAt, errorMessage),
    };
  }
}

function finalizeLaunchHealth(
  health: ChromiumLaunchHealth,
  attempts: ChromiumLaunchAttempt[],
): ChromiumLaunchHealth {
  if (attempts.length <= 1) {
    return attempts.length === 0 ? health : { ...health, attempts };
  }

  const failedTargets = attempts
    .filter((attempt) => !attempt.ok)
    .map((attempt) => attempt.browserTarget);
  const summarySuffix = failedTargets.length
    ? ` Sau đó hệ thống đã tự thử tiếp: ${failedTargets.join(", ")}.`
    : "";

  if (health.ok) {
    return {
      ...health,
      attempts,
      summary: `${health.summary}${summarySuffix}`,
    };
  }

  return {
    ...health,
    attempts,
    summary: `${health.summary} Đã thử lần lượt ${attempts
      .map((attempt) => attempt.browserTarget)
      .join(", ")} nhưng đều thất bại.`,
  };
}

function shouldTryNextLaunchCandidate(
  requestedOptions: BrowserLaunchOptions,
  attempts: ChromiumLaunchAttempt[],
  totalCandidates: number,
): boolean {
  if (attempts.length >= totalCandidates) return false;
  if (String(requestedOptions.executablePath ?? "").trim()) return false;
  const lastAttempt = attempts[attempts.length - 1];
  if (!lastAttempt || lastAttempt.ok) return false;
  return true;
}

function buildHealthProbeCandidates(options: BrowserLaunchOptions): BrowserLaunchOptions[] {
  const explicitExecutablePath = String(options.executablePath ?? "").trim();
  if (explicitExecutablePath) {
    return [
      {
        ...options,
        channel: undefined,
        executablePath: explicitExecutablePath,
      },
    ];
  }

  const candidates: BrowserLaunchOptions[] = [];
  for (const channel of buildChannelCandidates(normalizeChannel(String(options.channel ?? "")))) {
    if (!isBrowserChannelInstalled(channel)) continue;
    candidates.push({
      ...options,
      channel,
      executablePath: undefined,
    });
  }

  return dedupeLaunchCandidates(candidates);
}

function dedupeLaunchCandidates(candidates: BrowserLaunchOptions[]): BrowserLaunchOptions[] {
  const seen = new Set<string>();
  const output: BrowserLaunchOptions[] = [];
  for (const candidate of candidates) {
    const key = JSON.stringify({
      channel: String(candidate.channel ?? ""),
      executablePath: String(candidate.executablePath ?? ""),
      headless: candidate.headless === false ? false : true,
      timeout: Number(candidate.timeout ?? 0),
    });
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }
  return output;
}

function normalizeRequestedLaunchOptions(options: BrowserLaunchOptions): BrowserLaunchOptions {
  const executablePath = String(options.executablePath ?? "").trim();
  return executablePath
    ? {
        ...options,
        channel: undefined,
        executablePath,
      }
    : {
        ...options,
        executablePath: undefined,
      };
}

function isHeadlessModeRequested(options: BrowserLaunchOptions): boolean {
  return options.headless === false ? false : true;
}

function describeBrowserTarget(options: BrowserLaunchOptions): string {
  const executablePath = String(options.executablePath ?? "").trim();
  if (executablePath) return executablePath;
  const channel = normalizeChannel(String(options.channel ?? ""));
  if (channel) return `browser channel "${channel}"`;
  return "Google Chrome hoặc Microsoft Edge";
}

function classifyLaunchError(
  errorMessage: string,
  resolvedOptions: BrowserLaunchOptions,
): ChromiumLaunchHealth["errorCode"] {
  const lowered = errorMessage.toLowerCase();
  if (lowered.includes("remote-debugging-pipe") && lowered.includes("timeout")) {
    return "devtools_attach_timeout";
  }
  if (
    lowered.includes("executable doesn't exist") ||
    lowered.includes("could not find") ||
    lowered.includes("not found")
  ) {
    return "missing_browser";
  }
  if (lowered.includes("timeout")) {
    return "launch_timeout";
  }
  if (
    !resolvedOptions.channel &&
    !resolvedOptions.executablePath &&
    lowered.includes("browser") &&
    lowered.includes("install")
  ) {
    return "missing_browser";
  }
  return "launch_failed";
}

function buildLaunchSummary(
  errorCode: ChromiumLaunchHealth["errorCode"],
  resolvedOptions: BrowserLaunchOptions,
  durationMs: number,
  errorMessage: string,
): string {
  const target = describeBrowserTarget(resolvedOptions);
  if (errorCode === "devtools_attach_timeout") {
    return `Playwright đã mở ${target} nhưng không bắt tay được DevTools sau ${durationMs}ms. Crawl sẽ fail ngay từ bước khởi động browser.`;
  }
  if (errorCode === "missing_browser") {
    return SYSTEM_BROWSER_REQUIRED_SUMMARY;
  }
  if (errorCode === "launch_timeout") {
    return `Khởi động ${target} bị timeout sau ${durationMs}ms.`;
  }
  return `Khởi động ${target} thất bại: ${errorMessage}`;
}

function buildLaunchRecommendations(
  errorCode: ChromiumLaunchHealth["errorCode"],
  resolvedOptions: BrowserLaunchOptions,
): string[] {
  if (errorCode === "devtools_attach_timeout") {
    return [
      "Tắt toàn bộ tiến trình Chrome, Edge, Chromium đang chạy nền rồi thử lại.",
      "Kiểm tra antivirus, endpoint protection, hoặc chính sách máy có chặn DevTools remote-debugging-pipe hay không.",
      resolvedOptions.headless === false
        ? "Cập nhật Google Chrome hoặc Microsoft Edge rồi thử đăng nhập lại."
        : "Cập nhật Google Chrome hoặc Microsoft Edge rồi thử crawl lại.",
    ];
  }
  if (errorCode === "missing_browser") {
    return [
      "Cài đặt hoặc cập nhật Google Chrome.",
      "Nếu không dùng Chrome, hãy cài đặt hoặc cập nhật Microsoft Edge.",
    ];
  }
  if (errorCode === "launch_timeout") {
    return [
      "Tăng timeout browser launch nếu máy chạy rất chậm.",
      "Kiểm tra browser có bị treo ở lần chạy trước và còn giữ process nền hay không.",
    ];
  }
  return [
    "Xem chi tiết error để xác định nguyên nhân cụ thể.",
    "Thử lại sau khi tắt các browser process đang treo nền.",
  ];
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, 4_000);
}

function isBrowserChannelInstalled(channel: string): boolean {
  for (const executablePath of candidateExecutablePaths(channel)) {
    if (existsSync(executablePath)) {
      return true;
    }
  }

  return false;
}

function candidateExecutablePaths(channel: string): string[] {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const home = homedir();

  if (channel === "chrome") {
    return [
      ...registryBrowserPaths("chrome.exe"),
      join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(home, ".local", "bin", "google-chrome"),
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/snap/bin/chromium",
    ].filter(Boolean);
  }

  if (channel === "msedge") {
    return [
      ...registryBrowserPaths("msedge.exe"),
      join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
    ].filter(Boolean);
  }

  return [];
}

function registryBrowserPaths(executableName: string): string[] {
  if (process.platform !== "win32") return [];
  const cached = registryBrowserPathCache.get(executableName);
  if (cached) return cached;

  const paths = new Set<string>();
  const registryKeys = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
  ];
  for (const key of registryKeys) {
    for (const registryView of ["64", "32"]) {
      try {
        const output = execFileSync(
          "reg.exe",
          ["query", key, "/ve", `/reg:${registryView}`],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
          },
        );
        const match = output.match(WINDOWS_REGISTRY_PATH_PATTERN);
        const candidate = expandWindowsEnvironmentVariables(
          String(match?.[1] ?? "").trim().replace(/^"(.*)"$/, "$1"),
        );
        if (candidate && existsSync(candidate)) {
          paths.add(candidate);
        }
      } catch {
        // The key or registry view is optional.
      }
    }
  }

  const resolved = [...paths];
  registryBrowserPathCache.set(executableName, resolved);
  return resolved;
}

function expandWindowsEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    return process.env[name] ?? process.env[name.toUpperCase()] ?? match;
  });
}

function buildChannelCandidates(preferredChannel: string): string[] {
  const ordered = [preferredChannel, ...DEFAULT_BROWSER_CHANNELS];
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of ordered.map(normalizeChannel)) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }

  return output;
}

function normalizeChannel(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}
