import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { RawPost } from "../types.js";
import { normalizeRawMedia } from "./threads-media.js";
import {
  isRecord,
  metricNumber,
  sanitizeCachedCommentText,
} from "./threads-parsing.js";
import { cacheKey } from "./threads-url.js";

export interface ThreadsCacheConfig {
  assetDir: string;
  assetPathPrefix: string;
  crawlAssets: boolean;
  downloadAssets: boolean;
  downloadAvatars: boolean;
  includeCommentAssets: boolean;
}

// Bump when the cached shape or extraction behavior changes. Version 52
// re-crawls posts/comments so carousel slides collected by the browser are
// not hidden by older one-slide cache entries.
export const THREADS_EXTRACTION_VERSION = 52;

type PostCache = Record<string, RawPost>;

export function loadPostCache(cachePath: string): PostCache {
  if (!cachePath || !existsSync(cachePath)) return {};
  try {
    const payload = JSON.parse(readFileSync(cachePath, "utf8")) as unknown;
    if (!isRecord(payload)) return {};
    return Object.fromEntries(
      Object.entries(payload)
        .filter((entry): entry is [string, RawPost] => isRecord(entry[1]))
        .map(([key, post]) => [key, sanitizeCachedPost(post)]),
    );
  } catch {
    return {};
  }
}

export function savePostCache(cachePath: string, cache: PostCache): void {
  if (!cachePath) return;
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function isUsableCachedPost(
  post: RawPost,
  key: string,
  validateUrl: boolean,
  ttlMinutes: number,
  config: ThreadsCacheConfig,
): boolean {
  if (!cacheHasCurrentExtraction(post)) return false;
  if (validateUrl && !isValidCachedPost(post, key)) return false;
  if (ttlMinutes <= 0) return false;
  if (!cacheHasRequiredLocalAssets(post, config)) return false;
  return cacheIsFresh(post, ttlMinutes);
}

export function cleanCachedAssetPaths(
  post: RawPost,
  config: ThreadsCacheConfig,
): RawPost {
  const cleaned = post;
  if (cleaned.avatar_asset_path && !localAssetExists(config, cleaned.avatar_asset_path)) {
    cleaned.avatar_asset_path = "";
  }
  cleaned.media = normalizeRawMedia(cleaned.media).map((item) => ({
    ...item,
    asset_path: item.asset_path && localAssetExists(config, item.asset_path) ? item.asset_path : "",
  }));
  if (Array.isArray(cleaned.comments)) {
    cleaned.comments = cleaned.comments.map((comment) => ({
      ...comment,
      avatar_asset_path:
        comment.avatar_asset_path && localAssetExists(config, comment.avatar_asset_path)
          ? comment.avatar_asset_path
          : "",
      media: normalizeRawMedia(comment.media).map((item) => ({
        ...item,
        asset_path: item.asset_path && localAssetExists(config, item.asset_path) ? item.asset_path : "",
      })),
    }));
  }
  return cleaned;
}

export function cacheHasCurrentExtraction(post: RawPost): boolean {
  const snapshot = isRecord(post.metrics_snapshot) ? post.metrics_snapshot : {};
  if (Number(snapshot.extraction_version ?? 0) < THREADS_EXTRACTION_VERSION) {
    return false;
  }

  // The collector's comment selection is only trustworthy when every cached
  // comment carries the metadata used to exclude nested replies and preserve
  // Threads' displayed order. Empty comments are valid for summary-only posts.
  return cacheHasCommentSelectionMetadata(post);
}

export function cacheHasFullExtraction(post: RawPost): boolean {
  if (!cacheHasCurrentExtraction(post)) return false;
  const snapshot = isRecord(post.metrics_snapshot) ? post.metrics_snapshot : {};
  return String(snapshot.extraction_depth ?? "full") === "full";
}

export function cacheHasRequestedCommentCount(
  post: RawPost,
  requestedTopComments: number,
): boolean {
  const target = Math.max(0, Math.trunc(requestedTopComments || 0));
  if (target === 0) return true;

  const comments = Array.isArray(post.comments)
    ? post.comments.filter((comment) => comment.is_reply !== true)
    : [];
  // A cached post with fewer comments than the current request must be
  // re-opened. Otherwise changing the UI from 1 to 7 comments keeps reusing
  // the old partial result forever.
  return comments.length >= target;
}

function cacheHasCommentSelectionMetadata(post: RawPost): boolean {
  const comments = Array.isArray(post.comments) ? post.comments : [];
  return comments.every(
    (comment) =>
      typeof comment.is_reply === "boolean" &&
      Number.isFinite(Number(comment.source_order)) &&
      Number(comment.source_order) >= 1,
  );
}
function sanitizeCachedPost(post: RawPost): RawPost {
  const comments = Array.isArray(post.comments)
    ? post.comments.map((comment) => ({
        ...comment,
        text: sanitizeCachedCommentText(
          comment.text,
          metricNumber(comment.like_count),
          metricNumber(comment.reply_count),
        ),
      }))
    : [];

  return {
    ...post,
    comments,
  };
}

function cacheHasRequiredLocalAssets(post: RawPost, config: ThreadsCacheConfig): boolean {
  if (!config.crawlAssets || !config.downloadAvatars) return true;
  if (!assetAvailable(config, post.avatar_asset_path, post.avatar_url)) return false;
  if (config.downloadAssets) {
    for (const item of normalizeRawMedia(post.media)) {
      if (!assetAvailable(config, item.asset_path, item.remote_url)) {
        return false;
      }
    }
  }
  if (!config.downloadAssets || !config.includeCommentAssets) return true;
  const comments = Array.isArray(post.comments) ? post.comments.slice(0, 20) : [];
  for (const comment of comments) {
    for (const item of normalizeRawMedia(comment.media)) {
      if (!assetAvailable(config, item.asset_path, item.remote_url)) {
        return false;
      }
    }
  }
  return true;
}

function assetAvailable(
  config: ThreadsCacheConfig,
  assetPath: unknown,
  remoteUrl: unknown,
): boolean {
  const remote = String(remoteUrl ?? "").trim();
  if (localAssetExists(config, assetPath)) return true;
  return /^https?:\/\//i.test(remote);
}

function localAssetExists(config: ThreadsCacheConfig, assetPath: unknown): boolean {
  const value = String(assetPath ?? "").trim();
  if (!value) return false;
  if (isAbsolute(value)) return existsSync(value);

  const normalizedValue = value.replace(/\\/g, "/");
  const normalizedPrefix = config.assetPathPrefix.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedPrefix && normalizedValue.startsWith(`${normalizedPrefix}/`)) {
    const relativePath = normalizedValue.slice(normalizedPrefix.length + 1);
    return existsSync(join(config.assetDir, ...relativePath.split("/").filter(Boolean)));
  }

  return false;
}

function isValidCachedPost(post: RawPost, key: string): boolean {
  const status = isRecord(post.url_status) ? post.url_status : {};
  const text = String(post.text ?? "").trim();
  if (status.accessible !== true) return false;
  if (text.length < 10) return false;
  return cacheKey(String(post.url ?? "")) === key;
}

function cacheIsFresh(post: RawPost, ttlMinutes: number): boolean {
  let crawledAt = String(post.crawled_at ?? "");
  if (!crawledAt && isRecord(post.metrics_snapshot)) {
    crawledAt = String(post.metrics_snapshot.crawled_at ?? "");
  }
  const timestamp = Date.parse(crawledAt);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= Math.max(1, ttlMinutes) * 60_000;
}
