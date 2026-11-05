import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ScanMode = "all" | "staged";

interface FileFailure {
  file: string;
  problems: string[];
}

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const decoder = new TextDecoder("utf-8", { fatal: true });

const binaryExtensions = new Set([
  ".asar",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".ogg",
  ".pdf",
  ".png",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".lock",
  ".md",
  ".mjs",
  ".ps1",
  ".scss",
  ".sh",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const textBasenames = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "README",
  "README.md",
  "LICENSE",
  "Dockerfile",
]);

const skipPrefixes = [
  ".desktop-runtime/",
  ".git/",
  ".local-web-runtime/",
  ".tmp/",
  ".turbo/",
  "apps/server/src/modules/video/abbreviation-dictionary.ts",
  "data/",
  "dist-desktop/",
  "exported_videos/",
  "node_modules/",
  "release/",
  "scripts/check-text-integrity.ts",
  "storage/",
];

const mojibakePatterns = [
  /Ã[\u0080-\u00BF\u00C0-\u017F]/g,
  /Â[\u0080-\u00BF\u00C0-\u017F]/g,
  /Ä[\u0080-\u00BF\u00C0-\u017F]/g,
  /Å[\u0080-\u00BF\u00C0-\u017F]/g,
  /Æ[\u0080-\u00BF\u00C0-\u017F]/g,
  /Ð[\u0080-\u00BF\u00C0-\u017F]/g,
  /Ñ[\u0080-\u00BF\u00C0-\u017F]/g,
  /Ò[\u0080-\u00BF\u00C0-\u017F]/g,
  /áº/g,
  /á»/g,
  /Ä‘/g,
  /Æ¡/g,
  /Æ°/g,
];

function main(): void {
  const mode = resolveMode(process.argv.slice(2));
  const files = listGitFiles(mode).filter(shouldScanFile);
  const failures = files.map(scanFile).filter((value): value is FileFailure => value !== null);

  if (failures.length > 0) {
    console.error("Text integrity check failed.");
    console.error("");
    for (const failure of failures) {
      console.error(`- ${failure.file}`);
      for (const problem of failure.problems) {
        console.error(`  ${problem}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Text integrity check passed for ${files.length} file(s) in ${mode} mode.`);
}

function resolveMode(args: string[]): ScanMode {
  if (args.includes("--staged")) {
    return "staged";
  }
  return "all";
}

function listGitFiles(mode: ScanMode): string[] {
  const args =
    mode === "staged"
      ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]
      : ["ls-files"];
  const output = execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function shouldScanFile(file: string): boolean {
  if (skipPrefixes.some((prefix) => file.startsWith(prefix))) {
    return false;
  }

  const extension = extname(file).toLowerCase();
  if (binaryExtensions.has(extension)) {
    return false;
  }

  const name = basename(file);
  if (textBasenames.has(name)) {
    return true;
  }

  return textExtensions.has(extension);
}

function scanFile(file: string): FileFailure | null {
  const absolutePath = resolve(rootDir, file);
  if (!existsSync(absolutePath)) {
    return null;
  }

  const problems: string[] = [];
  const bytes = readFileSync(absolutePath);
  if (bytes.includes(0)) {
    problems.push("contains NUL byte(s), expected UTF-8 text.");
    return { file, problems };
  }

  let text = "";
  try {
    text = decoder.decode(bytes);
  } catch {
    problems.push("is not valid UTF-8.");
    return { file, problems };
  }

  if (text.includes("\uFFFD")) {
    problems.push("contains replacement character U+FFFD.");
  }

  const controlLine = findLineWithMatch(text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/);
  if (controlLine) {
    problems.push(`contains unexpected control character at line ${controlLine.line}: ${controlLine.preview}`);
  }

  const mojibakeLine = findSuspiciousMojibake(text);
  if (mojibakeLine) {
    problems.push(`contains suspicious mojibake at line ${mojibakeLine.line}: ${mojibakeLine.preview}`);
  }

  return problems.length > 0 ? { file, problems } : null;
}

function findSuspiciousMojibake(text: string): { line: number; preview: string } | null {
  for (const pattern of mojibakePatterns) {
    const match = findLineWithMatch(text, pattern);
    if (match) {
      return match;
    }
  }
  return null;
}

function findLineWithMatch(
  text: string,
  pattern: RegExp,
): { line: number; preview: string } | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    matcher.lastIndex = 0;
    if (!matcher.test(line)) {
      continue;
    }
    return {
      line: index + 1,
      preview: line.trim().slice(0, 160),
    };
  }
  return null;
}

main();
