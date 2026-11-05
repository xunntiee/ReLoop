import type { CrawlOutputFile, CrawlRun } from "@/lib/api";

export function canCancelRun(run: CrawlRun): boolean {
  return ["queued", "running"].includes(run.status);
}

export function canResumeRun(run: CrawlRun): boolean {
  return (
    run.status === "stopped_partial" &&
    !run.resumedToRunId &&
    Boolean(run.outputPath) &&
    (run.progress?.resume_ready ?? true)
  );
}

export function isActiveRun(run: CrawlRun): boolean {
  return ["queued", "running", "stopping"].includes(run.status);
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatRunDuration(run: CrawlRun, now: number): string {
  const start = Date.parse(run.runningStartedAt ?? run.startedAt);
  if (!Number.isFinite(start)) return "-";
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  if (!Number.isFinite(end)) return "-";
  return formatDuration(Math.max(0, end - start));
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function numberFromInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const formatted = size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${formatted} ${units[unitIndex] ?? "B"}`;
}

export function formatOutputDisplayLabel(
  file: Pick<
    CrawlOutputFile,
    | "filename"
    | "label"
    | "partial"
    | "pendingResumeCount"
    | "posts"
    | "previewPostCount"
    | "requestMeta"
  >
): string {
  const topicTitle = String(file.requestMeta?.topic?.topic_title ?? "").trim();
  // The compact output-list response intentionally omits requestMeta. The
  // server has already computed the display label from the saved file, so do
  // not fall back to "Viral feed" when metadata is loaded lazily.
  if (!topicTitle && file.label.trim()) {
    return file.label.trim();
  }
  const baseLabel = topicTitle || file.filename.replace(/\.json$/i, "") || "Viral feed";
  if (file.partial && file.posts === 0 && Number(file.pendingResumeCount ?? 0) > 0) {
    return `${baseLabel} | Moc tam`;
  }
  if (file.partial && Number(file.previewPostCount ?? 0) > 0) {
    return `${baseLabel} | Preview tam`;
  }
  return `${baseLabel} | ${formatNumber(Math.max(0, file.posts))} bai`;
}

export function assetSources(assetPath: string | undefined, remoteUrl: string | undefined): string[] {
  const localPath = String(assetPath ?? "").trim();
  const remotePath = String(remoteUrl ?? "").trim();
  const preferRemote =
    isLegacyThreadsCommentAvatarPath(localPath) ||
    remotePath.startsWith("/media/");
  const allowLegacyLocalFallback = !(preferRemote && remotePath);
  const remoteProxyPath =
    remotePath && shouldProxyRemoteAsset(remotePath)
      ? `/api/crawl/assets/remote?url=${encodeURIComponent(remotePath)}`
      : "";
  const localSources = [
    allowLegacyLocalFallback && localPath ? `/media/${localPath}` : "",
    allowLegacyLocalFallback && localPath ? `/api/crawl/assets?path=${encodeURIComponent(localPath)}` : "",
  ];
  const remoteSources = [
    remotePath.startsWith("/") ? remotePath : "",
    /^https?:\/\//i.test(remotePath) ? remotePath : "",
    remoteProxyPath,
  ];
  return [
    ...(preferRemote ? remoteSources : localSources),
    ...(preferRemote ? localSources : remoteSources),
  ].filter(Boolean);
}

function shouldProxyRemoteAsset(remotePath: string): boolean {
  if (!/^https?:\/\//i.test(remotePath)) {
    return false;
  }

  try {
    const hostname = new URL(remotePath).hostname.toLowerCase();
    // Meta CDN URLs are signed and commonly session/time bound. If direct browser
    // loading fails, backend proxy retries usually fail too and only spam 502 logs.
    if (
      hostname === "fbcdn.net" ||
      hostname.endsWith(".fbcdn.net") ||
      hostname === "cdninstagram.com" ||
      hostname.endsWith(".cdninstagram.com")
    ) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

function isLegacyThreadsCommentAvatarPath(localPath: string): boolean {
  const normalized = localPath.replace(/\\/g, "/");
  return (
    /^data\/assets\/threads\/.+\/comments\/.+-comment-\d+-avatar\.[a-z0-9]+$/i.test(normalized) &&
    !/-avatar-[0-9a-f]{10}\.[a-z0-9]+$/i.test(normalized)
  );
}

export function localTimestampForId(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    String(date.getMilliseconds()).padStart(3, "0"),
  ]
    .map((part, index) => (index === 6 ? String(part) : String(part).padStart(2, "0")))
    .join("");
}

export function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "threads"
  );
}

export function formatRelativeTime(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return "Vừa xong";
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  return new Intl.DateTimeFormat("vi", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function resolveRunPhaseMessage(run: CrawlRun, now: number): string {
  if (run.status === "queued") return "Đang chờ trong hàng đợi...";
  if (run.status !== "running") return "";
  const start = Date.parse(run.runningStartedAt ?? run.startedAt);
  if (!Number.isFinite(start)) return "Đang khởi động...";
  const elapsed = Math.max(0, now - start) / 1000;
  if (elapsed < 15) return "🔍 Đang tìm kiếm bài viết...";
  if (elapsed < 45) return "📥 Đang tải nội dung bài viết...";
  if (elapsed < 90) return "✨ Đang chọn ra những bài viral nhất...";
  return "💾 Sắp xong, đang lưu kết quả...";
}
