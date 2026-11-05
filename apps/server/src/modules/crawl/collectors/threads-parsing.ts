import type { RawComment } from "../types.js";
import { parseCreatedAtDateKey } from "../utils/date-range.js";
import { isLikelyVietnameseText } from "../utils/text.js";
import { normalizeRawMedia } from "./threads-media.js";
import { decodeHtmlEntities, matchPostUrl } from "./threads-url.js";

export interface ThreadsParsingFilterConfig {
  allowedLanguages: string[];
  dateEnd: string;
  dateStart: string;
  dateTimezone?: string;
}

export type MetricField =
  | "view_count"
  | "reply_count"
  | "repost_count"
  | "like_count"
  | "quote_count"
  | "share_count";

type ResolvedMetricMap = Record<MetricField, number>;

export type MetricResolution = {
  confidence: number;
  fieldSources: Record<MetricField, string>;
  issues: string[];
  metrics: ResolvedMetricMap;
};

const METRIC_FIELDS: MetricField[] = [
  "view_count",
  "reply_count",
  "repost_count",
  "like_count",
  "quote_count",
  "share_count",
];

const RELATIVE_TIME_UNIT_PATTERN = [
  "s",
  "m",
  "h",
  "d",
  "w",
  "mo",
  "y",
  "gio",
  "gi\\u1edd",
  "giay",
  "gi\\u00e2y",
  "phut",
  "ph\\u00fat",
  "ngay",
  "ng\\u00e0y",
  "tuan",
  "tu\\u1ea7n",
  "thang",
  "th\\u00e1ng",
  "nam",
  "n\\u0103m",
].join("|");

const POST_TEXT_PATTERNS = [
  /on Threads:\s*["'](?<text>.*?)["']\s*$/s,
  /on Threads:\s*(?<text>.+)$/s,
];

const VIETNAMESE_MARKERS =
  "\u0103\u00e2\u0111\u00ea\u00f4\u01a1\u01b0" +
  "\u00e1\u00e0\u1ea3\u00e3\u1ea1" +
  "\u1ea5\u1ea7\u1ea9\u1eab\u1ead" +
  "\u1eaf\u1eb1\u1eb3\u1eb5\u1eb7" +
  "\u00e9\u00e8\u1ebb\u1ebd\u1eb9" +
  "\u1ebf\u1ec1\u1ec3\u1ec5\u1ec7" +
  "\u00ed\u00ec\u1ec9\u0129\u1ecb" +
  "\u00f3\u00f2\u1ecf\u00f5\u1ecd" +
  "\u1ed1\u1ed3\u1ed5\u1ed7\u1ed9" +
  "\u1edb\u1edd\u1edf\u1ee1\u1ee3" +
  "\u00fa\u00f9\u1ee7\u0169\u1ee5" +
  "\u1ee9\u1eeb\u1eed\u1eef\u1ef1" +
  "\u00fd\u1ef3\u1ef7\u1ef9\u1ef5";

const IGNORED_COMMENT_LINES = new Set([
  "activity",
  "back",
  "follow",
  "following",
  "for you",
  "home",
  "insights",
  "like",
  "likes",
  "log in",
  "mention",
  "notifications",
  "original poster",
  "profile",
  "reply",
  "replies",
  "repost",
  "saved",
  "search",
  "share",
  "threads",
  "translate",
  "hiển thị phản hồi",
  "hien thi phan hoi",
  "hiển thị câu trả lời",
  "hien thi cau tra loi",
  "show replies",
  "show responses",
  "view responses",
  "view replies",
]);

const IGNORED_COMMENT_SUBSTRINGS = [
  "notificationsprofile",
  "log in to see",
  "log in or sign up",
  "threads terms",
  "privacy policy",
];

export function skipReasonBeforeDeepExtraction(
  post: { createdAt: string; language: string },
  config: ThreadsParsingFilterConfig,
): string {
  const allowedLanguages = new Set(
    config.allowedLanguages.map((item) => item.trim().toLowerCase()).filter(Boolean),
  );
  const language = post.language.trim().toLowerCase();
  if (allowedLanguages.size > 0) {
    if (!language || language === "unknown") return "";
    if (!allowedLanguages.has(language)) return "early_language_not_allowed";
  }

  const dateKey = parseCreatedAtDateKey(post.createdAt, config.dateTimezone);
  if ((config.dateStart || config.dateEnd) && !dateKey) return "early_missing_created_at";
  if (config.dateStart && dateKey && dateKey < config.dateStart) return "early_date_before_start";
  if (config.dateEnd && dateKey && dateKey > config.dateEnd) return "early_date_after_end";
  return "";
}

export function pageIsUnavailable(meta: unknown): boolean {
  if (!isRecord(meta)) return true;
  const haystack = ["title", "ogTitle", "ogDescription", "bodyText", "canonical", "finalUrl"]
    .map((key) => String(meta[key] ?? ""))
    .join("\n")
    .toLowerCase();
  return [
    "this content isn't available",
    "content unavailable",
    "sorry, this page isn't available",
    "page isn't available",
    "this page isn't available",
    "this page isn't working right now",
    "something went wrong",
    "http error 429",
    "too many requests",
    "try again later",
  ].some((marker) => haystack.includes(marker));
}

export function isValidPostText(text: string): boolean {
  const value = cleanText(text);
  if (value.length < 3) return false;
  return !new Set(["threads", "log in", "sign up", "home", "search"]).has(
    value.toLowerCase(),
  );
}

export function looksLikeThreadsPageShell(text: string): boolean {
  const normalized = foldAscii(cleanText(text).toLowerCase());
  if (!normalized) return false;

  const shellMarkers = [
    "trang chu",
    "thread moi",
    "tim kiem",
    "tin nhan",
    "hoat dong",
    "trang ca nhan",
    "tham gia threads",
    "dang nhap bang instagram",
    "thong tin chi tiet",
    "bang feed khac",
    "xem hoat dong",
    "dieu khoan cua threads",
    "chinh sach quyen rieng tu",
    "chinh sach cookie",
  ];
  const markerCount = shellMarkers.filter((marker) =>
    normalized.includes(marker),
  ).length;
  return markerCount >= 2;
}

export function extractDisplayName(title: string, username: string): string {
  const text = decodeHtmlEntities(title).trim();
  const match = new RegExp(`^(.*?)\\s*\\(@${escapeRegExp(username)}\\)`).exec(text);
  return match?.[1]?.trim() || username;
}

export function extractPostText(
  description: string,
  displayName: string,
  username: string,
): string {
  const text = decodeHtmlEntities(description).trim();
  for (const pattern of POST_TEXT_PATTERNS) {
    const match = pattern.exec(text);
    const value = match?.groups?.text;
    if (value) return stripLeadingPostHeader(cleanStructuredPostText(value), displayName, username);
  }
  const authorPrefix = new RegExp(
    `^${escapeRegExp(displayName)}\\s*\\(@${escapeRegExp(username)}\\)\\s*[:-]\\s*(?<text>.+)$`,
    "s",
  );
  const match = authorPrefix.exec(text);
  return stripLeadingPostHeader(
    cleanStructuredPostText(match?.groups?.text ?? text),
    displayName,
    username,
  );
}

function stripLeadingPostHeader(value: string, displayName: string, username: string): string {
  const normalizedValue = stripEmbeddedPostUiPrefix(
    cleanStructuredPostText(value),
    username,
  );
  const lines = normalizedValue
    .split("\n")
    .filter(Boolean);
  if (lines.length === 0) return "";

  const first = lines[0] ?? "";
  const second = lines[1] ?? "";
  const firstLooksLikeHeader = looksLikePostHeaderIdentity(first, displayName, username);
  const firstContainsRelativeTime = isRelativeTime(first) || isDateish(first) || isTimestampish(first);

  if (firstContainsRelativeTime) {
    return cleanStructuredPostText(lines.slice(1).join("\n"));
  }

  // On a direct permalink Threads may expose the display name/reply context
  // and its relative time inside og:description, before the actual caption.
  // Example: "display name\n23 giờ\ncaption".
  if (isRelativeTime(second) || isDateish(second) || isTimestampish(second)) {
    if (firstLooksLikeHeader || first.length <= 80) {
      return cleanStructuredPostText(lines.slice(2).join("\n"));
    }
  }

  if (firstLooksLikeHeader && containsRelativeTimeToken(first)) {
    return cleanStructuredPostText(lines.slice(1).join("\n"));
  }

  return normalizedValue;
}

function stripEmbeddedPostUiPrefix(value: string, username: string): string {
  const text = String(value ?? "").trim();
  const normalizedUsername = username.trim().replace(/^@/, "");
  if (!text || !normalizedUsername) return text;

  // Threads sometimes concatenates the conversation header into og:description
  // when the page is loaded from a permalink/embed. It is UI, not post text.
  const embeddedHeader = new RegExp(
    `^Cuộc\\s+trò\\s+chuyện\\s+đầu\\s+tiên\\s*Theo\\s+dõi\\s*@?${escapeRegExp(
      normalizedUsername,
    )}\\s*\\d+\\s*(?:giây|giờ|ngày|tuần|tháng|năm|s|m|h|d|w|mo|y)?\\s*Xem\\s+thêm\\s*`,
    "iu",
  );
  const embeddedTrendHeader = new RegExp(
    `^(?:N\\u00eau\\s+b\\u1eadt\\s*)?(?:Th\\u1ecbnh\\s+h\\u00e0nh\\s*:\\s*[\\s\\S]*?)?Theo\\s+d\\u00f5i\\s*@?${escapeRegExp(
      normalizedUsername,
    )}\\s*\\d+\\s*(?:gi\\u00e2y|gi\\u1edd|ng\\u00e0y|tu\\u1ea7n|th\\u00e1ng|n\\u0103m|s|m|h|d|w|mo|y)?\\s*Xem\\s+th\\u00eam\\s*`,
    "iu",
  );
  return text.replace(embeddedHeader, "").replace(embeddedTrendHeader, "").trim();
}

function looksLikePostHeaderIdentity(value: string, displayName: string, username: string): boolean {
  const normalized = foldAscii(cleanText(value).toLowerCase());
  if (!normalized) return false;
  const identities = [displayName, username]
    .map((item) => foldAscii(cleanText(item).replace(/^@/, "").toLowerCase()))
    .filter(Boolean);
  return identities.some((identity) => normalized === identity || normalized.startsWith(`${identity} `));
}

function containsRelativeTimeToken(value: string): boolean {
  const normalized = foldAscii(cleanText(value).toLowerCase());
  return /\b\d+\s*(?:s|m|h|d|w|mo|y|gio|giay|phut|ngay|tuan|thang|nam)\b/.test(normalized);
}

export function extractInitialPostText(
  description: string,
  displayName: string,
  username: string,
  bodyText: string,
): string {
  const metaText = extractPostText(description, displayName, username);
  if (
    metaText.length >= 10 &&
    isValidPostText(metaText) &&
    !looksLikeThreadsPageShell(metaText)
  ) {
    return metaText;
  }
  return extractFirstContentLine(bodyText, username);
}

export function extractFormattedPostTextFromArticle(
  articleText: string,
  username: string,
  fallbackText: string,
): string {
  const normalizedFallbackText = stripEmbeddedPostUiPrefix(
    cleanStructuredPostText(fallbackText),
    username,
  );
  const fallbackKey = cleanText(normalizedFallbackText).toLowerCase();
  if (fallbackKey.length < 10) return "";

  const rawLines = lines(decodeHtmlEntities(articleText));
  if (rawLines.length === 0) return "";

  const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();
  const startIndex = rawLines.findIndex((line) => {
    const normalized = cleanText(line).toLowerCase().replace(/^@/, "");
    return normalized === normalizedUsername || normalized.startsWith(`${normalizedUsername} `);
  });
  const scanStart = startIndex >= 0 ? startIndex + 1 : 0;
  const candidateLines: string[] = [];

  for (let index = scanStart; index < rawLines.length && candidateLines.length < 24; index += 1) {
    const line = stripEmbeddedPostUiPrefix(
      cleanStructuredPostText(rawLines[index] ?? ""),
      username,
    );
    if (!line) continue;
    const normalized = cleanText(line).toLowerCase();
    if (!normalized) continue;
    if (normalized === normalizedUsername || normalized === `@${normalizedUsername}`) continue;
    if (
      candidateLines.length === 1 &&
      isRelativeTime(line) &&
      (candidateLines[0]?.length ?? 0) <= 80
    ) {
      candidateLines.length = 0;
      continue;
    }
    if (isDateish(line) || isRelativeTime(line) || isTimestampish(line)) continue;
    if (isPostUiBoundaryLine(line)) {
      if (candidateLines.length > 0) break;
      continue;
    }
    if (isCountish(line) || isLikelyActionMetricLine(line)) {
      if (candidateLines.length > 0) break;
      continue;
    }
    candidateLines.push(line);
  }

  const firstContentIndex = candidateLines.findIndex((line) =>
    lineMatchesFallbackText(line, fallbackKey),
  );
  if (firstContentIndex < 0) return "";
  const contentStartIndex = resolveFormattedPostContentStartIndex(
    candidateLines,
    firstContentIndex,
  );

  const formatted = cleanStructuredPostText(
    candidateLines.slice(contentStartIndex).join("\n"),
  );
  if (!formatted.includes("\n")) return "";

  const formattedKey = cleanText(formatted).toLowerCase();
  const fallbackPrefix = fallbackKey.slice(0, Math.min(80, fallbackKey.length));
  const formattedPrefix = formattedKey.slice(0, Math.min(80, formattedKey.length));
  if (
    formattedKey.includes(fallbackPrefix) ||
    fallbackKey.includes(formattedPrefix) ||
    formattedKey.length >= Math.floor(fallbackKey.length * 0.6)
  ) {
    return formatted;
  }

  return "";
}

export function restorePostIntroFromActivityTexts(
  text: string,
  activityTexts: string[],
): string {
  const formatted = cleanStructuredPostText(text);
  const currentLines = formatted.split("\n").filter(Boolean);
  if (!formatted || currentLines.length === 0) return formatted;
  if (!isStructuredListLine(currentLines[0] ?? "")) return formatted;

  const firstListLineKey = cleanText(currentLines[0] ?? "").toLowerCase();
  const formattedKey = cleanText(formatted).toLowerCase();
  if (firstListLineKey.length < 3 || formattedKey.length < 10) return formatted;

  for (const rawText of activityTexts) {
    const candidate = cleanText(decodeHtmlEntities(String(rawText ?? "")));
    if (!candidate) continue;

    const candidateKey = candidate.toLowerCase();
    const listStartIndex = candidateKey.indexOf(firstListLineKey);
    if (listStartIndex <= 0) continue;

    const candidateSuffix = candidateKey.slice(listStartIndex);
    const formattedPrefix = formattedKey.slice(0, Math.min(120, formattedKey.length));
    if (!candidateSuffix.includes(formattedPrefix)) continue;

    const intro = cleanPostText(candidate.slice(0, listStartIndex));
    if (!isLikelyPostIntroLine(intro)) continue;

    return cleanStructuredPostText([intro, ...currentLines].join("\n"));
  }

  return formatted;
}

export function extractFirstContentLine(bodyText: string, username: string): string {
  const permalinkBodyText = extractPermalinkBodyPostText(bodyText, username);
  if (isValidPostText(permalinkBodyText)) {
    return permalinkBodyText;
  }

  const ignored = new Set(["threads", "reply", "repost", "share", "like", "log in", "sign up"]);
  const rawLines = String(bodyText ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  const contentLines: string[] = [];
  for (const rawLine of rawLines) {
    const line = cleanPostText(rawLine);
    const normalized = line.toLowerCase();
    if (normalized.includes(username.toLowerCase())) continue;
    if (ignored.has(normalized)) continue;
    if (line.length >= 3) {
      contentLines.push(line);
    }
  }

  const paragraph = cleanStructuredPostText(contentLines.join("\n"));
  if (paragraph.length >= 3 && !looksLikeThreadsPageShell(paragraph)) {
    return paragraph;
  }
  return "";
}

function extractPermalinkBodyPostText(bodyText: string, username: string): string {
  const normalizedUsername = normalizeUsernameToken(username);
  if (!normalizedUsername) return "";

  const bodyLines = lines(decodeHtmlEntities(bodyText));
  const usernameIndex = bodyLines.findIndex((line) =>
    isExactUsernameLine(line, normalizedUsername),
  );
  if (usernameIndex < 0) return "";

  const contentLines: string[] = [];
  for (let index = usernameIndex + 1; index < bodyLines.length && contentLines.length < 24; index += 1) {
    const line = cleanStructuredPostText(bodyLines[index] ?? "");
    if (!line) continue;

    if (isDateish(line) || isRelativeTime(line) || isTimestampish(line)) {
      if (
        contentLines.length === 1 &&
        (contentLines[0]?.length ?? 0) <= 80 &&
        isRelativeTime(line)
      ) {
        contentLines.length = 0;
        continue;
      }
      if (contentLines.length > 0) break;
      continue;
    }
    if (isCountish(line) || isLikelyActionMetricLine(line) || isPostUiBoundaryLine(line)) {
      if (contentLines.length > 0) break;
      continue;
    }
    if (isPermalinkLeadingUiLine(line)) {
      if (contentLines.length > 0) break;
      continue;
    }
    if (contentLines.length > 0 && isPermalinkCommentBoundary(bodyLines, index)) {
      break;
    }

    contentLines.push(line);
  }

  return stripEmbeddedPostUiPrefix(
    cleanStructuredPostText(contentLines.join("\n")),
    username,
  );
}

function isExactUsernameLine(value: string, normalizedUsername: string): boolean {
  const normalized = normalizeUsernameToken(value);
  return normalized === normalizedUsername || normalized.startsWith(`${normalizedUsername} `);
}

function normalizeUsernameToken(value: string): string {
  return cleanText(String(value ?? ""))
    .replace(/^@/, "")
    .toLowerCase();
}

function isPermalinkLeadingUiLine(value: string): boolean {
  const normalized = foldAscii(cleanText(value).toLowerCase());
  if (!normalized) return true;
  return new Set([
    "dang nhap",
    "log in",
    "thread",
    "threads",
    "tac gia",
    "author",
    "original poster",
  ]).has(normalized);
}

function isPermalinkCommentBoundary(bodyLines: string[], index: number): boolean {
  const line = cleanText(bodyLines[index] ?? "");
  const next = cleanText(bodyLines[index + 1] ?? "");
  if (!looksLikeStandaloneUsernameLine(line)) return false;
  return isDateish(next) || isRelativeTime(next) || foldAscii(next.toLowerCase()) === "tac gia";
}

function looksLikeStandaloneUsernameLine(value: string): boolean {
  const text = cleanText(value).replace(/^@/, "");
  if (text.length < 2 || text.length > 32) return false;
  return /^[a-z0-9._]+$/i.test(text);
}

export function extractPostMetrics(
  articleText: string,
  bodyText: string,
  postText: string,
  metricTexts: string[],
): Record<string, number | string> {
  const labeled = extractLabeledMetrics([...metricTexts, ...lines(bodyText)]);
  const positional = extractPositionalPostMetrics(articleText || bodyText, postText);
  const metrics: Record<string, number | string> = {
    view_count: 0,
    reply_count: 0,
    repost_count: 0,
    like_count: 0,
    quote_count: 0,
    share_count: 0,
    source: "",
  };

  for (const key of [
    "view_count",
    "reply_count",
    "repost_count",
    "like_count",
    "quote_count",
    "share_count",
  ]) {
    if (key in labeled) {
      metrics[key] = labeled[key] ?? 0;
      metrics.source = "labeled_dom";
    } else if (key in positional) {
      metrics[key] = positional[key] ?? 0;
      if (!metrics.source) metrics.source = "positional_text";
    }
  }
  return metrics;
}

export function resolvePostMetrics(
  base: Record<string, number | string>,
  activity: Record<string, number>,
  options: { extractionDepth: "full" | "summary" },
): MetricResolution {
  const baseSource = String(base.source ?? "").trim() || "unknown";
  const metrics: ResolvedMetricMap = {
    view_count: 0,
    reply_count: 0,
    repost_count: 0,
    like_count: 0,
    quote_count: 0,
    share_count: 0,
  };
  const fieldSources = Object.fromEntries(
    METRIC_FIELDS.map((field) => [field, ""]),
  ) as Record<MetricField, string>;
  const issues: string[] = [];

  for (const field of METRIC_FIELDS) {
    const activityValue = metricNumber(activity[field]);
    const baseValue = metricNumber(base[field]);
    if (activityValue > 0) {
      metrics[field] = activityValue;
      fieldSources[field] = "activity_modal";
    } else if (baseValue > 0) {
      metrics[field] = baseValue;
      fieldSources[field] = baseSource;
    }
  }

  for (const field of METRIC_FIELDS) {
    const currentValue = metrics[field];
    if (currentValue <= 0) continue;
    const activityValue = metricNumber(activity[field]);
    const baseValue = metricNumber(base[field]);
    const fallbackValue =
      fieldSources[field] === "activity_modal" && baseValue > 0
        ? baseValue
        : fieldSources[field] !== "activity_modal" && activityValue > 0
          ? activityValue
          : 0;
    const fallbackSource =
      fieldSources[field] === "activity_modal" && baseValue > 0
        ? baseSource
        : fieldSources[field] !== "activity_modal" && activityValue > 0
          ? "activity_modal"
          : "";
    if (!isPlausibleMetricField(field, currentValue, metrics)) {
      if (
        fallbackValue > 0 &&
        isPlausibleMetricField(field, fallbackValue, { ...metrics, [field]: fallbackValue })
      ) {
        metrics[field] = fallbackValue;
        fieldSources[field] = fallbackSource;
        issues.push(`fallback_${field}`);
      } else {
        metrics[field] = 0;
        fieldSources[field] = fieldSources[field] ? `${fieldSources[field]}_dropped` : "dropped";
        issues.push(`dropped_${field}`);
      }
    }
  }

  const sourceConfidence =
    METRIC_FIELDS.reduce(
      (score, field) => score + metricFieldSourceConfidence(fieldSources[field]),
      0,
    ) / METRIC_FIELDS.length;
  const depthPenalty = options.extractionDepth === "summary" ? 0.18 : 0;
  const issuePenalty = Math.min(0.45, issues.length * 0.08);
  const confidence = roundMetricConfidence(
    Math.max(0.05, sourceConfidence - depthPenalty - issuePenalty),
  );

  return {
    confidence,
    fieldSources,
    issues,
    metrics,
  };
}

export function parseCommentBlocks(
  blocks: unknown,
  postId: string,
  authorUsername: string,
  postText: string,
  options: {
    includeNestedReplies?: boolean;
    preserveSourceOrder?: boolean;
    relaxedThreadContext?: boolean;
  } = {},
): RawComment[] {
  const comments: RawComment[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(blocks)) return comments;

  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (Boolean(block.isRootPost)) continue;
    if (options.includeNestedReplies === false && Boolean(block.isReply)) continue;
    if (!options.relaxedThreadContext && isBeforeCommentSection(block)) continue;
    const blockPostId = matchPostUrl(String(block.href ?? ""))?.postId;
    if (blockPostId && blockPostId === postId) continue;
    const username = String(block.username ?? "").trim().replace(/^@/, "");
    if (!username) continue;

    const rawText = String(block.text ?? "");
    const extractedText = extractCommentText(rawText, username, postText);
    if (!extractedText) continue;
    const metricTexts = asStringList(block.metricTexts);
    const metrics = extractCommentMetrics(rawText, metricTexts, extractedText);
    const likeCount = metrics.like_count || metricNumber(block.likeCount);
    const replyCount = metrics.reply_count || metricNumber(block.replyCount);
    const text = sanitizeCachedCommentText(extractedText, likeCount, replyCount);
    if (!text) continue;

    const key = `${username.toLowerCase()}\n${commentTextKey(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    comments.push({
      username,
      display_name: extractDisplayNameFromBlock(rawText, username),
      avatar_url: String(block.avatarUrl ?? ""),
      avatar_asset_path: "",
      language: guessLanguage(text),
      text,
      like_count: likeCount,
      reply_count: replyCount,
      created_at: "",
      media: normalizeRawMedia(block.media),
      is_reply: Boolean(block.isReply),
      source_order: comments.length + 1,
    });
  }
  const orderedComments = options.preserveSourceOrder
    ? comments
    : comments.sort(
      (a, b) =>
        metricNumber(b.like_count) - metricNumber(a.like_count) ||
        metricNumber(b.reply_count) - metricNumber(a.reply_count),
    );
  return orderedComments.map((comment, index) => ({
      ...comment,
      comment_id: `${postId}-comment-${index + 1}`,
    }));
}

function isBeforeCommentSection(block: Record<string, unknown>): boolean {
  const top = finiteNumber(block.top);
  const commentSectionTop = finiteNumber(block.commentSectionTop);
  return (
    top !== null &&
    commentSectionTop !== null &&
    top < commentSectionTop - 8
  );
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sanitizeCachedCommentText(
  value: unknown,
  likeCount: unknown,
  replyCount: unknown,
): string {
  const raw = String(value ?? "");
  if (/\r?\n/.test(raw)) {
    return sanitizeFormattedCommentText(
      raw,
      metricNumber(likeCount),
      metricNumber(replyCount),
    );
  }
  const cleaned = restoreFlattenedListFormatting(stripLeadingRelativeTimeArtifacts(
    stripCommentUiPrefix(
      stripCommentUiTail(
        stripCommentMetricTail(
          String(value ?? ""),
          metricNumber(likeCount),
          metricNumber(replyCount),
        ),
      ),
    ),
  ));
  if (metricNumber(likeCount) > 0 || metricNumber(replyCount) > 0) {
    if (cleaned.includes("\n")) {
      const strippedFormatted = sanitizeFormattedCommentText(
        cleaned,
        metricNumber(likeCount),
        metricNumber(replyCount),
      );
      if (strippedFormatted) return strippedFormatted;
    }
    const stripped = stripTrailingStandaloneMetricToken(cleaned);
    if (stripped) return stripped;
  }
  return cleaned;
}

function sanitizeFormattedCommentText(
  value: string,
  likeCount: number,
  replyCount: number,
): string {
  const cleanedLines = lines(value)
    .map((line) =>
      stripLeadingRelativeTimeArtifacts(
        stripCommentUiPrefix(
          stripCommentUiTail(stripCommentMetricTail(line, likeCount, replyCount)),
        ),
      ),
    )
    .filter(Boolean);

  if (cleanedLines.length === 0) return "";

  if (likeCount > 0 || replyCount > 0) {
    const lastIndex = cleanedLines.length - 1;
    const stripped = stripTrailingStandaloneMetricToken(cleanedLines[lastIndex] ?? "");
    if (stripped) cleanedLines[lastIndex] = stripped;
  }

  return cleanFormattedText(cleanedLines.join("\n"));
}

function restoreFlattenedListFormatting(value: string): string {
  const text = cleanText(value);
  if (!text || text.includes("\n")) return text;

  const bulletMarkers = Array.from(text.matchAll(/\s[-+]\s+\S/g));
  const ageRangeMarkers = Array.from(text.matchAll(/\s\d{1,2}\s*-\s*\d{1,2}\s*t\s*:/gi));
  const hasButSection = /\s(?:NHƯNG|NHUNG):\s*\+/i.test(text);
  if (bulletMarkers.length + ageRangeMarkers.length < 2 && !hasButSection) {
    return text;
  }

  const formatted = text
    .replace(/\s+([^\s:]{3,}:)\s*(?=\+)/g, "\n$1\n")
    .replace(/\s+(?=(?:NHƯNG|NHUNG):\s*\+)/gi, "\n")
    .replace(/\s+(?=\d{1,2}\s*-\s*\d{1,2}\s*t\s*:)/gi, "\n")
    .replace(/\s+(-\s+\S)/g, "\n$1")
    .replace(/\s+(\+\s+\S)/g, "\n$1")
    .replace(/((?:NHƯNG|NHUNG):)\s*(?=\+)/gi, "$1\n");

  return cleanFormattedText(formatted);
}

export function metricNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^["']+|["']+$/g, "");
}

export function cleanFormattedText(value: string): string {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.replace(/^["']+|["']+$/g, "");
}

export function cleanPostText(value: string): string {
  let text = cleanText(value);
  for (let index = 0; index < 3; index += 1) {
    const next = stripMetricCountTail(stripPostActionMetricTail(stripActionTail(text)));
    if (next === text) break;
    text = next;
  }
  return cleanText(text);
}

export function cleanStructuredPostText(value: string): string {
  const normalized = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ");
  const lines = normalized
    .split("\n")
    .map((line) => cleanPostText(line))
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  const compacted: string[] = [];
  for (const line of lines) {
    if (line === compacted[compacted.length - 1]) {
      continue;
    }
    compacted.push(line);
  }

  const structured = compacted.join("\n");
  const { spacedTail, compactTail } = postActionMetricTailPatterns();
  return structured
    .replace(spacedTail, "")
    .replace(compactTail, "")
    .replace(/\s+$/u, "")
    .trim();
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter((item) => item.trim()) : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripCommentUiPrefix(value: string): string {
  let text = cleanText(value);
  if (!text) return "";

  const uiPrefixes = [
    /^(?:[\u00b7\u2022]\s*)?(?:tác\s+giả|tac\s+gia|author|original\s+poster)(?=$|[\s:.-])[\s:.-]*/i,
    /^(?:trả lời bài viết không hiển thị|tra loi bai viet khong hien thi|reply(?:ing)? to hidden post)(?=$|[\s:.-])[\s:.-]*/i,
    /^(?:trả lời bài viết|tra loi bai viet|reply(?:ing)? to (?:the )?post)(?=$|[\s:.-])[\s:.-]*/i,
  ];

  for (let index = 0; index < 4; index += 1) {
    let changed = false;
    for (const pattern of uiPrefixes) {
      const next = cleanText(text.replace(pattern, ""));
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return cleanPostText(text);
}

export function stripCommentUiTail(value: string): string {
  let text = cleanText(value);
  if (!text) return "";

  const countToken = String.raw`\d+(?:[.,]\d+)?\s*[KkMmBb]?`;
  const pagerToken = String.raw`\d+\s*\/\s*\d+`;
  const usernameToken = String.raw`@?[a-z0-9_.]{2,32}\.{0,3}`;
  const uiLabelPattern = [
    "Hàng đầu",
    "Hang dau",
    "Top",
    "Xem hoạt động",
    "Xem hoat dong",
    "View activity",
    "Trả lời",
    "Tra loi",
    "Reply",
    "Replying",
    "Hiển thị phản hồi",
    "Hien thi phan hoi",
    "Hiển thị trả lời",
    "Hien thi tra loi",
    "Hiển thị câu trả lời",
    "Hien thi cau tra loi",
    "Xem phản hồi",
    "Xem phan hoi",
    "Show replies",
    "Show responses",
    "View replies",
    "View responses",
    "Chưa có câu trả lời nào",
    "Chua co cau tra loi nao",
    "Translate",
    "Dịch",
    "Dich",
  ]
    .map(escapeRegExp)
    .join("|");
  const relativeTimeToken = String.raw`\d+\s*(?:s|m|h|d|w|mo|y|gio|giờ|ngay|ngày|phut|phút|tuan|tuần|thang|tháng|nam|năm)`;

  for (let index = 0; index < 4; index += 1) {
    const next = cleanText(
      text
        .replace(
          new RegExp(
            String.raw`\s+(?:(?:${pagerToken}|${countToken})\s+){1,10}(?:${uiLabelPattern})(?:[\s\S]*)$`,
            "i",
          ),
          "",
        )
        .replace(
          new RegExp(
            String.raw`\s+(?:(?:${pagerToken}|${countToken})\s+){2,10}${usernameToken}\s+${relativeTimeToken}(?:[\s\S]*)$`,
            "i",
          ),
          "",
        )
        .replace(
          new RegExp(
            String.raw`\s+(?:${pagerToken}\s+)?(?:${countToken})(?:\s+${countToken}){1,9}$`,
            "i",
          ),
          "",
        ),
    );

    if (next === text) break;
    text = next;
  }

  return text;
}

export function stripCommentMetricTail(
  value: string,
  likeCount: number,
  replyCount: number,
): string {
  let text = cleanText(value);
  if (!text) return "";

  const suffixes: number[][] = [];
  if (likeCount > 0 && replyCount > 0) suffixes.push([likeCount, replyCount]);
  if (likeCount > 0) suffixes.push([likeCount]);
  if (replyCount > 0 && replyCount !== likeCount) suffixes.push([replyCount]);

  for (const counts of suffixes) {
    const pattern = new RegExp(
      String.raw`\s+(?:${counts.map((count) => metricTailTokenPattern(count)).join(String.raw`\s+`)})$`,
      "i",
    );
    const next = cleanText(text.replace(pattern, ""));
    if (next && next.length >= 2) {
      text = next;
      break;
    }
  }

  return text;
}

export function stripLeadingRelativeTimeArtifacts(value: string): string {
  let text = cleanText(value);
  if (!text) return "";

  const patterns = [
    new RegExp(`^\\d+\\s*(?:${RELATIVE_TIME_UNIT_PATTERN})\\b\\s*`, "iu"),
    /^i(?:\u1edd|o)\s+/iu,
  ];

  for (const pattern of patterns) {
    text = cleanText(text.replace(pattern, ""));
  }

  return text;
}

export function parseDateKey(value: unknown): string {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function extractLabeledMetrics(values: string[]): Record<string, number> {
  const aliases: Record<string, string[]> = {
    view_count: ["view", "views", "lượt xem", "luot xem"],
    reply_count: [
      "reply",
      "replies",
      "comment",
      "comments",
      "trả lời",
      "tra loi",
      "bình luận",
      "binh luan",
      "phản hồi",
      "phan hoi",
    ],
    repost_count: [
      "repost",
      "reposts",
      "reposted",
      "đăng lại",
      "dang lai",
      "lượt đăng lại",
      "luot dang lai",
    ],
    like_count: ["like", "likes", "liked", "thích", "thich", "lượt thích", "luot thich"],
    quote_count: ["quote", "quotes", "trích dẫn", "trich dan"],
    share_count: ["share", "shares", "shared", "chia sẻ", "chia se", "lượt chia sẻ", "luot chia se"],
  };
  const metrics: Record<string, number> = {};
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    for (const [key, names] of Object.entries(aliases)) {
      if (key in metrics) continue;
      const count = parseMetric(text, names);
      if (count > 0) metrics[key] = count;
    }
  }
  return metrics;
}

export function extractActivityMetricRows(
  bodyText: string,
  labelTexts: string[] = [],
): Record<string, number> {
  const output: Record<string, number> = {};
  const bodyLines = lines(bodyText);
  const metricTexts = labelTexts.map(cleanText).filter(Boolean);
  const labels: Record<string, string[]> = {
    view_count: ["views", "view", "lượt xem", "luot xem"],
    like_count: ["likes", "like", "lượt thích", "luot thich"],
    reply_count: ["replies", "reply", "comments", "comment", "trả lời", "tra loi", "bình luận", "binh luan"],
    repost_count: ["reposts", "repost", "lượt đăng lại", "luot dang lai"],
    quote_count: ["quotes", "quote", "trích dẫn", "trich dan"],
    share_count: ["shares", "share", "lượt chia sẻ", "luot chia se"],
  };

  for (const [key, names] of Object.entries(labels)) {
    const labelIndex = bodyLines.findIndex((line) => names.some((name) => labelMatches(line, name)));
    if (labelIndex >= 0) {
      const labelLine = bodyLines[labelIndex] ?? "";
      const inline = parseMetricAfterLabel(labelLine, names) || parseMetric(labelLine, names);
      if (inline > 0) output[key] = inline;
      if (key in output) continue;

      for (const candidate of bodyLines.slice(labelIndex + 1, labelIndex + 5)) {
        if (!isCountish(candidate)) continue;
        output[key] = parseCount(candidate);
        break;
      }
    }
    if (key in output) continue;

    const direct = firstMetricAfterLabel(metricTexts, names) || firstMetric(metricTexts, names);
    if (direct > 0) output[key] = direct;
  }
  return output;
}

function isPlausibleMetricField(
  field: MetricField,
  value: number,
  metrics: ResolvedMetricMap,
): boolean {
  if (value <= 0) return true;
  const views = metrics.view_count;
  const likes = metrics.like_count;
  const replies = metrics.reply_count;

  if (views > 0) {
    if (field !== "view_count" && value > views) return false;
    if (field === "like_count" && views >= 1_000 && value === views) return false;
    if (field === "reply_count" && value > Math.max(views * 0.85, likes * 6 + 40)) {
      return false;
    }
    if (field === "repost_count" && value > Math.max(views * 0.6, likes * 4 + 20)) {
      return false;
    }
    if (field === "share_count" && value > Math.max(views * 0.6, likes * 4 + 20)) {
      return false;
    }
    if (field === "quote_count" && value > Math.max(views * 0.4, replies * 2 + 20)) {
      return false;
    }
  } else {
    if (field === "reply_count" && likes > 0 && value > likes * 8 + 40) return false;
    if (field === "repost_count" && likes > 0 && value > likes * 5 + 20) return false;
    if (field === "share_count" && likes > 0 && value > likes * 5 + 20) return false;
    if (field === "reply_count" && value >= 20_000) return false;
    if (field === "repost_count" && value >= 20_000) return false;
    if (field === "share_count" && value >= 20_000) return false;
  }

  return true;
}

function metricFieldSourceConfidence(source: string): number {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) return 0.2;
  if (normalized === "activity_modal") return 0.98;
  if (normalized === "labeled_dom") return 0.85;
  if (normalized === "positional_text") return 0.55;
  if (normalized.endsWith("_dropped")) return 0.2;
  return 0.45;
}

function roundMetricConfidence(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function extractPositionalPostMetrics(
  bodyText: string,
  postText: string,
): Record<string, number> {
  const bodyLines = lines(bodyText);
  const postIndex = bodyLines.findIndex(
    (line) => line.toLowerCase() === cleanText(postText).toLowerCase(),
  );
  if (postIndex < 0) return {};

  const counts: number[] = [];
  for (const line of bodyLines.slice(postIndex + 1, postIndex + 12)) {
    if (!isCountish(line)) {
      if (counts.length > 0) break;
      continue;
    }
    counts.push(parseCount(line));
    if (counts.length >= 4) break;
  }
  if (counts.length < 3) return {};
  return {
    reply_count: counts[0] ?? 0,
    repost_count: counts[1] ?? 0,
    like_count: counts[2] ?? 0,
    share_count: counts[3] ?? 0,
  };
}

function extractCommentText(rawText: string, username: string, postText: string): string {
  const scoped = scopedCommentLines(rawText, username);
  return pickCommentText(scoped, username, postText);
}

function commentTextKey(text: string): string {
  return stripActionTail(text).toLowerCase().replace(/\s+/g, " ").slice(0, 260);
}

function scopedCommentLines(rawText: string, username: string): string[] {
  const rawLines = lines(rawText);
  const startIndex = rawLines.findIndex((line) => isUsernameLine(line, username));
  if (startIndex < 0) {
    const embeddedIndex = rawLines.findIndex(
      (line) => embeddedUsernameIndex(line, username) >= 0,
    );
    if (embeddedIndex < 0) return [];
    const sliceIndex = embeddedUsernameIndex(rawLines[embeddedIndex] ?? "", username);
    const firstLine = trimAfterNextCommentHeader(
      (rawLines[embeddedIndex] ?? "").slice(sliceIndex),
      username,
    );
    return [firstLine, ...rawLines.slice(embeddedIndex + 1, embeddedIndex + 8)];
  }

  const section: string[] = [];
  for (let index = startIndex; index < rawLines.length && section.length < 12; index += 1) {
    const line = rawLines[index] ?? "";
    if (index > startIndex && isLikelyNextCommentHeader(rawLines, index, username)) break;
    section.push(index === startIndex ? trimAfterNextCommentHeader(line, username) : line);
  }
  return section;
}

function pickCommentText(rawLines: string[], username: string, postText: string): string {
  const candidates: string[] = [];
  for (const rawLine of rawLines) {
    const line = stripLeadingRelativeTimeArtifacts(
      stripCommentUiPrefix(
        stripCommentUiTail(stripAuthorBadgeArtifacts(stripCommentLinePrefix(rawLine, username))),
      ),
    );
    const normalized = line.toLowerCase();
    if (normalized.startsWith("@") || normalized === username.toLowerCase()) continue;
    if (IGNORED_COMMENT_LINES.has(normalized)) continue;
    if (IGNORED_COMMENT_SUBSTRINGS.some((token) => normalized.includes(token))) continue;
    if (isDateish(line) || isRelativeTime(line)) continue;
    if (postText && postText.includes(line)) continue;
    if (normalized.includes("http://") || normalized.includes("https://")) continue;
    if (/^[\d,.]+[kmb]?$/i.test(normalized)) continue;
    if (/^[\W_]+$/u.test(normalized)) continue;
    if (line.length >= 3 && /[\p{L}\p{N}]/u.test(line)) candidates.push(line);
  }

  if (candidates.length >= 2) {
    return cleanFormattedText(candidates.join("\n"));
  }

  return candidates.sort((a, b) => commentLineScore(b) - commentLineScore(a))[0] ?? "";
}

function stripCommentLinePrefix(line: string, username: string): string {
  let value = cleanText(line);
  const usernamePattern = `@?${escapeRegExp(username)}`;
  value = value.replace(new RegExp(`^${usernamePattern}\\b`, "i"), "").trim();
  value = value.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/, "").trim();
  value = value
    .replace(
      /^\d+\s*(s|m|h|d|w|mo|y|giây|giay|phút|phut|g|ngày|ngay|tuần|tuan|tháng|thang|năm|nam)\s*/i,
      "",
    )
    .trim();
  value = trimAfterNextCommentHeader(value, username);
  return cleanPostText(value);
}

function stripAuthorBadgeArtifacts(value: string): string {
  let text = cleanText(value);
  if (!text) return "";

  const badgePatterns = [
    /^(?:[.\u00b7\u2022]\s*)?(?:tác\s+giả|tac\s+gia|author|original\s+poster)(?=$|[\s:.-])[\s:.-]*/i,
  ];

  for (let index = 0; index < 4; index += 1) {
    let changed = false;
    for (const pattern of badgePatterns) {
      const match = pattern.exec(text);
      if (match && match.index > 0) continue;
      const next = cleanText(text.replace(pattern, " "));
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return cleanPostText(text);
}

function isUsernameLine(line: string, username: string): boolean {
  const normalized = cleanText(line).toLowerCase();
  const value = normalized.replace(/^@/, "");
  const target = username.toLowerCase();
  return value === target || value.startsWith(`${target} `);
}

function isLikelyNextCommentHeader(
  rawLines: string[],
  index: number,
  currentUsername: string,
): boolean {
  const line = cleanText(rawLines[index] ?? "");
  const normalized = line.toLowerCase().replace(/^@/, "");
  if (
    normalized.startsWith(`${currentUsername.toLowerCase()} `) ||
    normalized === currentUsername.toLowerCase()
  ) {
    return false;
  }
  if (/^[a-z0-9_.]{2,32}\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i.test(line)) return true;
  if (/^@?[a-z0-9_.]{2,32}$/i.test(line)) {
    const next = cleanText(rawLines[index + 1] ?? "");
    return (
      isDateish(next) ||
      isRelativeTime(next) ||
      /^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(next)
    );
  }
  return false;
}

function embeddedUsernameIndex(line: string, username: string): number {
  const pattern = new RegExp(
    `(?:^|\\s)@?${escapeRegExp(username)}\\s+\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b`,
    "i",
  );
  const normalizedLine = cleanText(line);
  const match = pattern.exec(normalizedLine);
  if (!match || match.index < 0) return -1;
  const sliced = normalizedLine.slice(match.index).trimStart();
  return sliced.startsWith("@")
    ? match.index + normalizedLine.slice(match.index).indexOf("@")
    : match.index;
}

function trimAfterNextCommentHeader(line: string, currentUsername: string): string {
  const value = cleanText(line);
  const pattern = new RegExp(
    `\\s@?(?!${escapeRegExp(currentUsername)}\\b)[a-z0-9_.]{2,32}\\s+\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b`,
    "i",
  );
  const match = pattern.exec(value.slice(1));
  if (!match || match.index < 0) return value;
  return value.slice(0, match.index + 1).trim();
}

function stripActionTail(value: string): string {
  return cleanText(value)
    .replace(/\s+Translate(?:\s+\d+(?:[.,]\d+)?\s*[KkMmBb]?){0,4}\s*$/i, "")
    .replace(/\s+Dịch(?:\s+\d+(?:[.,]\d+)?\s*[KkMmBb]?){0,4}\s*$/i, "")
    .trim();
}

function metricTailTokenPattern(count: number): string {
  return metricCountVariants(count).map(escapeRegExp).join("|");
}

function metricCountVariants(count: number): string[] {
  const variants = new Set<string>();
  if (!Number.isFinite(count) || count <= 0) return [];

  const rounded = Math.floor(count);
  variants.add(String(rounded));
  variants.add(rounded.toLocaleString("en-US"));
  variants.add(rounded.toLocaleString("de-DE"));

  if (rounded >= 1_000) {
    const compact = rounded / 1_000;
    if (Number.isFinite(compact)) {
      const fixed =
        compact % 1 === 0
          ? compact.toFixed(0)
          : compact.toFixed(1).replace(/\.0$/, "");
      variants.add(`${fixed}K`);
      variants.add(`${fixed.toLowerCase()}k`);
      variants.add(`${fixed.replace(".", ",")}K`);
      variants.add(`${fixed.replace(".", ",").toLowerCase()}k`);
    }
  }

  return [...variants].filter(Boolean);
}

function extractDisplayNameFromBlock(rawText: string, username: string): string {
  const ignored = new Set([username.toLowerCase(), `@${username.toLowerCase()}`]);
  for (const line of scopedCommentLines(rawText, username).slice(0, 4)) {
    const cleanedLine = stripCommentUiPrefix(line);
    const normalized = cleanedLine.toLowerCase();
    if (isUsernameLine(line, username)) continue;
    if (ignored.has(normalized)) continue;
    if (
      IGNORED_COMMENT_LINES.has(normalized) ||
      isDateish(cleanedLine) ||
      isRelativeTime(cleanedLine)
    ) {
      continue;
    }
    if (cleanedLine.length >= 2 && cleanedLine.length <= 60 && !isCountish(cleanedLine)) {
      return cleanedLine;
    }
  }
  return username;
}

function extractCommentMetrics(
  rawText: string,
  metricTexts: string[],
  commentText: string,
): { like_count: number; reply_count: number } {
  const values = metricTexts.map(cleanText).filter(Boolean);
  const positional = extractCommentPositionalCounts(rawText, commentText);
  const likeCount = firstMetric(values, [
    "like",
    "likes",
    "thích",
    "thich",
    "lượt thích",
    "luot thich",
  ]);
  const replyCount = firstMetric(values, [
    "reply",
    "replies",
    "trả lời",
    "tra loi",
    "comment",
    "comments",
    "bình luận",
    "binh luan",
    "phản hồi",
    "phan hoi",
  ]);
  if (positional.length > 0) {
    return {
      like_count: positional[0] || likeCount || 0,
      reply_count: positional.length > 1 ? positional[1] || replyCount || 0 : 0,
    };
  }
  return {
    like_count: likeCount || 0,
    reply_count: replyCount || 0,
  };
}

function extractCommentPositionalCounts(rawText: string, commentText: string): number[] {
  const rawLines = lines(rawText);
  const normalizedComment = cleanText(commentText).toLowerCase();
  const textIndex = rawLines.findIndex((line) => {
    const normalizedLine = line.toLowerCase();
    return (
      normalizedLine === normalizedComment ||
      normalizedLine.includes(normalizedComment) ||
      normalizedComment.includes(normalizedLine)
    );
  });
  if (textIndex < 0) return [];

  let counts = inlineCommentActionCounts(rawLines[textIndex] ?? "", commentText);
  if (counts.length === 0) {
    const strippedCommentText = stripTrailingStandaloneMetricToken(commentText);
    if (strippedCommentText && strippedCommentText !== cleanText(commentText)) {
      counts = inlineCommentActionCounts(rawLines[textIndex] ?? "", strippedCommentText);
    }
  }
  if (counts.length >= 2) return counts;

  for (const line of rawLines.slice(textIndex + 1, textIndex + 8)) {
    if (!isCountish(line)) continue;
    counts.push(parseCount(line));
    if (counts.length >= 2) break;
  }
  return counts;
}

function inlineCommentActionCounts(line: string, commentText: string): number[] {
  const value = cleanText(line);
  const normalizedValue = value.toLowerCase();
  const normalizedComment = cleanText(commentText).toLowerCase();
  let startIndex = normalizedValue.indexOf(normalizedComment);
  if (startIndex < 0) {
    const shortened = normalizedComment.slice(0, Math.min(80, normalizedComment.length));
    startIndex = shortened.length >= 12 ? normalizedValue.indexOf(shortened) : -1;
  }
  if (startIndex < 0) return [];

  const afterComment = value.slice(
    startIndex + Math.min(value.length - startIndex, commentText.length),
  );
  const actionTail = afterComment
    .split(/\s@?[a-z0-9_.]{2,32}\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i)[0]
    ?.replace(/^.*?(?:Translate|Dịch|Like|Thích)\b/i, "")
    .trim();
  if (!actionTail) return [];

  return Array.from(actionTail.matchAll(/\b\d+(?:[.,]\d+)?\s*[KkMmBb]?\b/g))
    .map((match) => parseCount(match[0] ?? ""))
    .filter((count) => count > 0)
    .slice(0, 4);
}

function stripTrailingStandaloneMetricToken(value: string): string {
  return cleanText(String(value ?? "").replace(/\s+\d+(?:[.,]\d+)?\s*[KkMmBb]?\s*$/, ""));
}

function commentLineScore(line: string): number {
  const value = cleanText(line);
  if (value.length < 2) return 0;
  let score = Math.min(80, Math.max(8, value.length * 2));
  if (value.length < 8) score -= 4;
  if (Array.from(value.toLowerCase()).some((char) => VIETNAMESE_MARKERS.includes(char))) {
    score += 8;
  }
  if (value.includes("?")) score += 4;
  if (value.split(/\s+/).length >= 5) score += 5;
  if (value.length > 220) score -= 30;
  return score;
}

function firstMetric(values: string[], names: string[]): number {
  for (const value of values) {
    const count = parseMetric(value, names);
    if (count > 0) return count;
  }
  return 0;
}

function firstMetricAfterLabel(values: string[], names: string[]): number {
  for (const value of values) {
    const count = parseMetricAfterLabel(value, names);
    if (count > 0) return count;
  }
  return 0;
}

function parseMetricAfterLabel(text: string, names: string[]): number {
  const namePattern = names.map(escapeRegExp).join("|");
  const countPattern = metricCountPattern();
  const pattern = new RegExp(`(?:${namePattern})\\D{0,24}(?<count>${countPattern})`, "i");
  const match = pattern.exec(text);
  const count = match?.groups?.count;
  return count ? parseCount(count) : 0;
}

function parseMetric(text: string, names: string[]): number {
  const namePattern = names.map(escapeRegExp).join("|");
  const countPattern = metricCountPattern();
  const patterns = [
    new RegExp(`(?<count>${countPattern})\\s*(?:${namePattern})`, "i"),
    new RegExp(`(?:${namePattern})\\D{0,24}(?<count>${countPattern})`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const count = match?.groups?.count;
    if (count) return parseCount(count);
  }
  return 0;
}

function labelMatches(line: string, label: string): boolean {
  const normalizedLine = foldAscii(cleanText(line).toLowerCase());
  const normalizedLabel = foldAscii(cleanText(label).toLowerCase());
  if (!normalizedLabel) return false;
  if (normalizedLine === normalizedLabel) return true;
  const countPattern = metricCountPattern();
  return new RegExp(
    `^${escapeRegExp(normalizedLabel)}\\s*[:：-]?\\s*${countPattern}$`,
    "i",
  ).test(normalizedLine);
}

function parseCount(value: string): number {
  let text = value.trim().replace(/\s+/g, "");
  if (!text) return 0;
  let multiplier = 1;
  const suffix = text.slice(-1).toLowerCase();
  if (suffix === "k") {
    multiplier = 1_000;
    text = text.slice(0, -1);
  } else if (suffix === "m") {
    multiplier = 1_000_000;
    text = text.slice(0, -1);
  } else if (suffix === "b") {
    multiplier = 1_000_000_000;
    text = text.slice(0, -1);
  }

  if (multiplier > 1) {
    text = text.includes(",") && !text.includes(".")
      ? text.replace(",", ".")
      : text.replace(/,/g, "");
  } else if (text.includes(",") && !text.includes(".")) {
    text = text.replace(/,/g, "");
  } else if (text.includes(".") && !text.includes(",") && text.split(".").at(-1)?.length === 3) {
    text = text.replace(/\./g, "");
  } else {
    text = text.replace(/,/g, "");
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? Math.floor(parsed * multiplier) : 0;
}

function isCountish(value: string): boolean {
  return new RegExp(`^${metricCountPattern()}$`, "i").test(value.trim());
}

function isLikelyActionMetricLine(value: string): boolean {
  const text = cleanText(value);
  if (!text) return false;
  const countToken = metricCountPattern();
  const labelToken = [
    "like",
    "likes",
    "thích",
    "thich",
    "lượt thích",
    "luot thich",
    "reply",
    "replies",
    "trả lời",
    "tra loi",
    "comment",
    "comments",
    "bình luận",
    "binh luan",
    "phản hồi",
    "phan hoi",
    "repost",
    "reposts",
    "đăng lại",
    "dang lai",
    "share",
    "shares",
    "chia sẻ",
    "chia se",
    "quote",
    "quotes",
    "trích dẫn",
    "trich dan",
  ].join("|");
  return (
    new RegExp(`^(?:${countToken}\\s*){2,6}$`, "i").test(text) ||
    new RegExp(`^(?:(?:${countToken})\\s*(?:${labelToken})\\s*){1,6}$`, "i").test(text) ||
    new RegExp(`^(?:(?:${labelToken})\\s*(?:${countToken})\\s*){1,6}$`, "i").test(text)
  );
}

function isPostUiBoundaryLine(value: string): boolean {
  const normalized = foldAscii(cleanText(value).toLowerCase());
  const exactBoundaryLines = new Set([
    "hang dau",
    "top",
    "trang chu",
    "thread moi",
    "tim kiem",
    "tin nhan",
    "hoat dong",
    "trang ca nhan",
    "thong tin chi tiet",
    "bang feed khac",
    "thread",
    "dieu khoan cua threads",
    "chinh sach quyen rieng tu",
    "chinh sach cookie",
  ]);
  if (exactBoundaryLines.has(normalized)) return true;

  if (
    /^(?:\d+[.,]?\d*\s*)(?:trieu|million)?\s*(?:luot xem|views?)$/.test(normalized) ||
    /^(?:\d+[.,]?\d*\s*)?diem viral$/.test(normalized)
  ) {
    return true;
  }

  return [
    "xem hoat dong",
    "view activity",
    "reply",
    "tra loi",
    "translate",
    "dich",
    "post activity",
    "hoat dong doi voi bai viet",
    "dieu khoan cua threads",
    "chinh sach quyen rieng tu",
    "chinh sach cookie",
  ].some((token) => normalized === token || normalized.startsWith(`${token} `));
}

function lineMatchesFallbackText(line: string, fallbackKey: string): boolean {
  const key = cleanText(line).toLowerCase();
  if (!key || fallbackKey.length < 10) return false;
  const linePrefix = key.slice(0, Math.min(80, key.length));
  const fallbackPrefix = fallbackKey.slice(0, Math.min(80, fallbackKey.length));
  return key.includes(fallbackPrefix) || fallbackKey.includes(linePrefix);
}

function resolveFormattedPostContentStartIndex(
  candidateLines: string[],
  firstContentIndex: number,
): number {
  if (firstContentIndex <= 0) return firstContentIndex;

  const firstMatchedLine = candidateLines[firstContentIndex] ?? "";
  if (!isStructuredListLine(firstMatchedLine)) {
    return firstContentIndex;
  }

  let startIndex = firstContentIndex;
  for (
    let index = firstContentIndex - 1;
    index >= 0 && firstContentIndex - index <= 3;
    index -= 1
  ) {
    const line = candidateLines[index] ?? "";
    if (!isLikelyPostIntroLine(line)) break;
    startIndex = index;
    if (line.trim().endsWith(":")) break;
  }
  return startIndex;
}

function isStructuredListLine(value: string): boolean {
  const text = cleanText(value);
  return /^(?:\d{1,2}[.)]|[-+*])\s+\S/.test(text);
}

function isLikelyPostIntroLine(value: string): boolean {
  const text = cleanText(value);
  if (text.length < 3 || text.length > 180) return false;
  if (isDateish(text) || isRelativeTime(text) || isCountish(text)) return false;
  if (isPostUiBoundaryLine(text) || isLikelyActionMetricLine(text)) return false;
  if (isStructuredListLine(text)) return false;
  return true;
}

function metricCountPattern(): string {
  return String.raw`\d+(?:(?:[.,]\d{3})+|[.,]\d+)?\s*[KkMmBb]?`;
}

function isDateish(value: string): boolean {
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value.trim());
}

function isRelativeTime(value: string): boolean {
  const normalized = foldAscii(cleanText(value).toLowerCase());
  return /^\d+\s*(s|m|h|d|w|mo|y|gio|giay|phut|g|ngay|tuan|thang|nam)$/i.test(
    normalized,
  );
}

function isTimestampish(value: string): boolean {
  return /^\d{1,2}:\d{2}(?::\d{2})?\s+\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(
    value.trim(),
  );
}

function stripPostActionMetricTail(value: string): string {
  const countToken = String.raw`\d+(?:[.,]\d+)?\s*[KkMmBb]?`;
  const label = [
    "Like",
    "Likes",
    "Thích",
    "Thich",
    "Lượt thích",
    "Luot thich",
    "Reply",
    "Replies",
    "Trả lời",
    "Tra loi",
    "Repost",
    "Reposts",
    "Đăng lại",
    "Dang lai",
    "Share",
    "Shares",
    "Chia sẻ",
    "Chia se",
  ].join("|");
  const compactLabel = [
    "\u0054h\u00edch",
    "\u0054r\u1ea3 l\u1eddi",
    "\u0110\u0103ng l\u1ea1i",
    "\u0043hia s\u1ebb",
  ].join("|");
  const allLabels = `${label}|${compactLabel}`;
  const spacedTail = new RegExp(
    String.raw`\s+(?:(?:${allLabels})\s*${countToken}\s*){1,6}$`,
    "iu",
  );
  const compactTail = new RegExp(
    String.raw`(?:(?:${allLabels})\s*${countToken}){2,6}\s*$`,
    "iu",
  );
  return cleanText(
    value.replace(spacedTail, "").replace(compactTail, ""),
  );
}

function postActionMetricTailPatterns(): { compactTail: RegExp; spacedTail: RegExp } {
  const countToken = String.raw`\d+(?:[.,]\d+)?\s*[KkMmBb]?`;
  const label = [
    "Like",
    "Likes",
    "\u0054h\u00edch",
    "Thich",
    "L\u01b0\u1ee3t\\s+th\u00edch",
    "Luot thich",
    "Reply",
    "Replies",
    "\u0054r\u1ea3\\s+l\u1eddi",
    "Tra loi",
    "Repost",
    "Reposts",
    "\u0110\u0103ng\\s+l\u1ea1i",
    "Dang lai",
    "Share",
    "Shares",
    "Chia\\s+s\u1ebb",
    "Chia se",
  ].join("|");
  return {
    spacedTail: new RegExp(
      String.raw`\s+(?:(?:${label})\s*${countToken}\s*){1,6}$`,
      "iu",
    ),
    compactTail: new RegExp(
      String.raw`(?:(?:${label})\s*${countToken}){2,6}\s*$`,
      "iu",
    ),
  };
}

function stripMetricCountTail(value: string): string {
  const countToken = String.raw`\d+(?:[.,]\d+)?\s*[KkMmBb]?`;
  return cleanText(
    value.replace(new RegExp(String.raw`(?:\s+${countToken}){3,}\s*$`, "i"), ""),
  );
}

export function lines(value: string): string[] {
  return value.split(/\r?\n/).map(cleanText).filter(Boolean);
}

export function guessLanguage(text: string): string {
  return isLikelyVietnameseText(text) ? "vi" : "unknown";
}

function foldAscii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
