import { spawn } from "node:child_process";
import { trackVideoChildProcess } from "./runtime-processes.js";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONVERSION_FAILED_LINE_PATTERN = /\bconversion failed!?\s*$/i;
const MEDIA_FAILURE_LINE_PATTERN =
  /\b(?:error|failed|failure|cannot|unable|invalid|unsupported|denied|not found|no such)\b/i;

export const MISSING_FFMPEG_USER_MESSAGE =
  "App dang thieu bo xuat video. Hay cai lai bo tool hoac bao nguoi phu trach.";
export const RENDER_MEMORY_USER_MESSAGE =
  "May dang thieu bo nho de xuat video nay. Thu giam so bai/comment hoac dung video ngan hon.";
export const BROWSER_RENDER_TIMEOUT_USER_MESSAGE =
  "Không mở được Chrome/Edge headless để render card video. Thử đóng bớt trình duyệt đang treo rồi render lại.";

/** Keep FFmpeg version/configuration banners out of user-facing errors. */
export function compactMediaProcessError(
  stderr: string,
  fallback: string,
): string {
  const lines = String(stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isMediaBannerLine(line));
  const failureIndexes = lines
    .map((line, index) => ({ index, line }))
    .filter(
      ({ line }) =>
        !CONVERSION_FAILED_LINE_PATTERN.test(line) &&
        isLikelyMediaFailureLine(line),
    )
    .map(({ index }) => index)
    .slice(-8);
  const selectedIndexes = new Set([
    ...failureIndexes,
    ...lines.map((_, index) => index).slice(-4),
  ]);
  const useful = lines.filter((_, index) => selectedIndexes.has(index));
  const message = useful.join("\n").trim();
  if (!message) return fallback;
  return message.length > 2400 ? `${message.slice(-2397)}...` : message;
}

export async function ensureFfmpegReady(
  configuredPath?: string,
  baseDir?: string
): Promise<string> {
  const candidates = collectBinaryCandidates("ffmpeg", configuredPath, baseDir);

  for (const candidate of candidates) {
    if (looksLikeFilePath(candidate) && !existsSync(candidate)) {
      continue;
    }

    if (await canRun(candidate)) {
      rememberResolvedBinary("ffmpeg", candidate);
      rememberSiblingBinary("ffprobe", candidate);
      return candidate;
    }
  }

  throw new Error(MISSING_FFMPEG_USER_MESSAGE);
}

export async function findAvailableMediaBinary(
  name: "ffmpeg" | "ffprobe",
  baseDir?: string
): Promise<string | null> {
  const remembered =
    name === "ffmpeg"
      ? process.env.TOOL_BASE_RESOLVED_FFMPEG
      : process.env.TOOL_BASE_RESOLVED_FFPROBE;
  const candidates = collectBinaryCandidates(name, remembered, baseDir);

  for (const candidate of candidates) {
    if (looksLikeFilePath(candidate) && !existsSync(candidate)) {
      continue;
    }

    if (await canRun(candidate)) {
      rememberResolvedBinary(name, candidate);
      return candidate;
    }
  }

  return null;
}

export function formatVideoRenderErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error ?? "").trim();
  if (!message) {
    return "Co loi khi xu ly video.";
  }

  if (isFfmpegMissingMessage(message)) {
    return MISSING_FFMPEG_USER_MESSAGE;
  }

  if (isRenderMemoryMessage(message)) {
    return RENDER_MEMORY_USER_MESSAGE;
  }

  if (isBrowserLaunchTimeoutMessage(message)) {
    return BROWSER_RENDER_TIMEOUT_USER_MESSAGE;
  }

  return message;
}

function collectBinaryCandidates(
  name: "ffmpeg" | "ffprobe",
  configuredPath?: string,
  baseDir?: string
): string[] {
  const candidates = new Set<string>();
  const add = (value?: string) => {
    const normalized = normalizeCandidate(value, baseDir);
    if (normalized) {
      candidates.add(normalized);
    }
  };

  const roots = collectSearchRoots();
  const relativeCandidates =
    process.platform === "win32"
      ? [
          `apps/server/vendor/ffmpeg/bin/${name}.exe`,
          `vendor/ffmpeg/bin/${name}.exe`,
          `resources/ffmpeg/bin/${name}.exe`,
          `resources/ffmpeg/${name}.exe`,
          `ffmpeg/bin/${name}.exe`,
          `ffmpeg/${name}.exe`,
        ]
      : [
          `apps/server/vendor/ffmpeg/bin/${name}`,
          `vendor/ffmpeg/bin/${name}`,
          `resources/ffmpeg/bin/${name}`,
          `resources/ffmpeg/${name}`,
          `ffmpeg/bin/${name}`,
          `ffmpeg/${name}`,
        ];

  for (const root of roots) {
    for (const relativePath of relativeCandidates) {
      add(resolve(root, relativePath));
    }
  }

  add(configuredPath);

  if (process.platform === "win32") {
    add(resolve(`C:/${name}/bin/${name}.exe`));
    add(resolve(`C:/Program Files/ffmpeg/bin/${name}.exe`));
    add(resolve(`C:/Program Files (x86)/ffmpeg/bin/${name}.exe`));
    if (process.env.LOCALAPPDATA) {
      add(
        resolve(
          process.env.LOCALAPPDATA,
          `Microsoft/WinGet/Links/${name}.exe`
        )
      );
    }
  }

  add(name);
  return [...candidates];
}

function collectSearchRoots(): string[] {
  const roots = new Set<string>();
  const currentFileDir = dirname(fileURLToPath(import.meta.url));
  const runtimeResourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;

  for (const start of [
    process.cwd(),
    currentFileDir,
    dirname(process.execPath),
    typeof runtimeResourcesPath === "string" ? runtimeResourcesPath : "",
  ]) {
    for (const directory of walkAncestors(start)) {
      roots.add(directory);
    }
  }

  return [...roots];
}

function walkAncestors(start: string): string[] {
  const normalized = String(start ?? "").trim();
  if (!normalized) {
    return [];
  }

  const directories: string[] = [];
  let current = resolve(normalized);
  const root = parse(current).root;

  while (true) {
    directories.push(current);
    if (current === root) {
      break;
    }
    current = dirname(current);
  }

  return directories;
}

function normalizeCandidate(
  candidate: string | undefined,
  baseDir?: string
): string {
  const trimmed = String(candidate ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (!looksLikeFilePath(trimmed)) {
    return trimmed;
  }

  if (isAbsolute(trimmed)) {
    return resolve(trimmed);
  }

  return resolve(baseDir || process.cwd(), trimmed);
}

function rememberResolvedBinary(
  name: "ffmpeg" | "ffprobe",
  candidate: string
): void {
  if (name === "ffmpeg") {
    process.env.TOOL_BASE_RESOLVED_FFMPEG = candidate;
    return;
  }
  process.env.TOOL_BASE_RESOLVED_FFPROBE = candidate;
}

function rememberSiblingBinary(
  siblingName: "ffprobe",
  commandPath: string
): void {
  if (!looksLikeFilePath(commandPath) || !existsSync(commandPath)) {
    return;
  }

  const siblingPath = resolve(dirname(commandPath), executableNameForPlatform(siblingName));
  if (!existsSync(siblingPath)) {
    return;
  }

  process.env.TOOL_BASE_RESOLVED_FFPROBE = siblingPath;
}

function executableNameForPlatform(name: "ffmpeg" | "ffprobe"): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function looksLikeFilePath(value: string): boolean {
  return (
    value.includes("\\") ||
    value.includes("/") ||
    value.endsWith(".exe") ||
    value.endsWith(".cmd") ||
    value.endsWith(".bat")
  );
}

function isFfmpegMissingMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!/(ffmpeg|ffprobe)/i.test(normalized)) {
    return false;
  }

  return /(not found|enoent|ffmpegpath|path|missing|tim thay|khong co)/i.test(
    normalized
  );
}

function isRenderMemoryMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    /(cannot allocate memory|out of memory|error while filtering)/i.test(
      normalized
    ) && /ffmpeg|libx264|overlay|filter/i.test(normalized)
  );
}

function isBrowserLaunchTimeoutMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("launch: timeout") &&
    normalized.includes("exceeded") &&
    /(chrome|msedge|edge|playwright)/i.test(normalized)
  );
}

function isMediaBannerLine(line: string): boolean {
  return /^(?:ffmpeg|ffprobe) version\b|^built with\b|^configuration:|^lib[a-z0-9]+\s+\d/i.test(
    line,
  );
}

function isLikelyMediaFailureLine(line: string): boolean {
  return MEDIA_FAILURE_LINE_PATTERN.test(line);
}

async function canRun(command: string): Promise<boolean> {
  try {
    await runProcess(command, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = trackVideoChildProcess(
      spawn(command, args, {
        shell: false,
        windowsHide: true,
      }),
    );

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
