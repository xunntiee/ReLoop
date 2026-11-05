const MISSING_RENDERER_MESSAGE =
  "App đang thiếu bộ xuất video. Hãy cài lại bộ tool hoặc báo người phụ trách.";
const RENDER_MEMORY_MESSAGE =
  "Máy đang thiếu bộ nhớ để xuất video này. Thử giảm số bài/comment hoặc dùng video ngắn hơn.";
const BROWSER_RENDER_TIMEOUT_MESSAGE =
  "Không mở được Chrome/Edge headless để render card video. Thử đóng bớt trình duyệt đang treo rồi render lại.";

export function formatVideoRenderErrorMessage(input: string): string {
  const message = compactMediaError(String(input ?? "").trim());
  if (!message) {
    return "Có lỗi khi xử lý video.";
  }

  if (isMissingFfmpegMessage(message)) {
    return MISSING_RENDERER_MESSAGE;
  }

  if (isRenderMemoryMessage(message)) {
    return RENDER_MEMORY_MESSAGE;
  }

  if (isBrowserLaunchTimeoutMessage(message)) {
    return BROWSER_RENDER_TIMEOUT_MESSAGE;
  }

  return message;
}

function compactMediaError(message: string): string {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^(?:ffmpeg|ffprobe) version\b|^built with\b|^configuration:|^lib[a-z0-9]+\s+\d/i.test(
          line,
        ),
    );
  const useful = lines.slice(-12).join("\n").trim();
  if (!useful) return message;
  return useful.length > 1800 ? `${useful.slice(-1797)}...` : useful;
}

function isMissingFfmpegMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!/(ffmpeg|ffprobe)/i.test(normalized)) {
    return false;
  }

  return /(not found|enoent|path|ffmpegpath|missing|tim thay|khong co)/i.test(
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
