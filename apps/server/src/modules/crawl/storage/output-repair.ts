import { existsSync, readFileSync } from "node:fs";
import { loadPostCache } from "../collectors/threads-cache.js";
import { normalizeRawMedia } from "../collectors/threads-media.js";
import {
  metricNumber,
  sanitizeCachedCommentText,
} from "../collectors/threads-parsing.js";
import { buildOutputCommentsFromRawPost } from "../selection/post-evaluation.js";
import type { CommentData, RawPost, TopicData } from "../types.js";
import { writeJsonFileAtomic } from "./output-file.js";

const OUTPUT_COMMENT_REPAIR_VERSION = 7;

type RepairableRecord = Record<string, unknown>;

export interface OutputRepairOptions {
  persist?: boolean;
  rawCachePath?: string;
}

export interface OutputRepairResult {
  changed: boolean;
  output: TopicData[] | null;
}

export function readAndRepairOutputFile(
  filePath: string,
  options: OutputRepairOptions = {},
): OutputRepairResult {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return { changed: false, output: null };
    }

    const mediaRepaired = repairOutputMedia(parsed as TopicData[]);
    const repaired = repairTopicOutput(
      mediaRepaired.output ?? (parsed as TopicData[]),
      options.rawCachePath,
    );
    const result: OutputRepairResult = {
      changed: mediaRepaired.changed || repaired.changed,
      output: repaired.output,
    };
    if (result.changed && options.persist !== false) {
      writeJsonFileAtomic(filePath, result.output);
    }
    return result;
  } catch {
    return { changed: false, output: null };
  }
}

export function repairOutputMedia(output: TopicData[]): OutputRepairResult {
  let changed = false;
  const nextOutput = output.map((topic) => {
    let topicChanged = false;
    const posts = (Array.isArray(topic.posts) ? topic.posts : []).map((post) => {
      const existingMedia = Array.isArray(post.media) ? post.media : [];
      const media = normalizeRawMedia(existingMedia);
      const existingComments = Array.isArray(post.top_comments) ? post.top_comments : [];
      const comments = existingComments.map((comment) => {
        const existingCommentMedia = Array.isArray(comment.media) ? comment.media : [];
        const commentMedia = normalizeRawMedia(existingCommentMedia);
        const commentText = sanitizeCachedCommentText(
          comment.text,
          metricNumber(comment.like_count),
          metricNumber(comment.reply_count),
        );
        if (
          !mediaListsEqual(existingCommentMedia, commentMedia) ||
          commentText !== String(comment.text ?? "")
        ) {
          topicChanged = true;
          return { ...comment, media: commentMedia, text: commentText };
        }
        return comment;
      });
      const postMediaChanged = !mediaListsEqual(existingMedia, media);
      const commentsChanged = comments.some(
        (comment, index) => comment !== existingComments[index],
      );
      if (!postMediaChanged && !commentsChanged) return post;
      topicChanged = true;
      return { ...post, media, top_comments: comments };
    });
    if (!topicChanged) return topic;
    changed = true;
    return { ...topic, posts };
  });
  return { changed, output: changed ? nextOutput : output };
}

export function repairTopicOutput(
  output: TopicData[],
  rawCachePath?: string,
): OutputRepairResult {
  if (!requiresCommentRepair(output)) {
    return { changed: false, output };
  }
  if (!rawCachePath || !existsSync(rawCachePath)) {
    return { changed: false, output };
  }

  const rawLookup = buildRawPostLookup(loadPostCache(rawCachePath));
  if (rawLookup.size === 0) {
    return { changed: false, output };
  }

  let changed = false;
  const nextOutput = output.map((topic) => {
    const topicRecord = topic as unknown as RepairableRecord;
    const crawlAudit = isRecord(topicRecord.crawl_audit)
      ? { ...topicRecord.crawl_audit }
      : {};
    if (Number(crawlAudit.output_comment_repair_version ?? 0) >= OUTPUT_COMMENT_REPAIR_VERSION) {
      return topic;
    }

    const requestMeta = isRecord(topicRecord.request_meta) ? topicRecord.request_meta : null;
    const currentPosts = Array.isArray(topic.posts) ? topic.posts : [];
    if (!requestMeta || currentPosts.length === 0) {
      return topic;
    }

    const languages = stringArray(requestMeta.languages);
    const minCommentLikes = Math.max(0, Number(requestMeta.min_comment_likes ?? 0) || 0);
    const topCommentsPerPost = Math.max(
      0,
      Number(requestMeta.top_comments_per_post ?? 5) || 5,
    );

    let repairedTopic = false;
    let inspectedTopic = false;
    const nextPosts = currentPosts.map((post) => {
      const rawPost = findRawPost(rawLookup, post);
      if (!rawPost) {
        return post;
      }
      inspectedTopic = true;

      const rebuilt = buildOutputCommentsFromRawPost(rawPost, {
        languages,
        min_comment_likes: minCommentLikes,
        top_comments_per_post: topCommentsPerPost,
      }).comments;
      const existingComments = Array.isArray(post.top_comments) ? post.top_comments : [];
      if (!commentRepairDiffers(existingComments, rebuilt)) {
        return post;
      }

      repairedTopic = true;
      changed = true;
      return {
        ...post,
        top_comments: mergeRepairedComments(existingComments, rebuilt),
      };
    });

    if (!repairedTopic && !inspectedTopic) {
      return topic;
    }

    crawlAudit.output_comment_repair_version = OUTPUT_COMMENT_REPAIR_VERSION;
    crawlAudit.output_comment_repaired_at = new Date().toISOString();
    changed = true;
    return {
      ...topic,
      crawl_audit: crawlAudit,
      posts: nextPosts,
    };
  });

  return {
    changed,
    output: changed ? nextOutput : output,
  };
}

function requiresCommentRepair(output: TopicData[]): boolean {
  return output.some((topic) => {
    const topicRecord = topic as unknown as RepairableRecord;
    const crawlAudit = isRecord(topicRecord.crawl_audit)
      ? topicRecord.crawl_audit
      : null;
    return Number(crawlAudit?.output_comment_repair_version ?? 0) <
      OUTPUT_COMMENT_REPAIR_VERSION;
  });
}

function buildRawPostLookup(cache: Record<string, RawPost>): Map<string, RawPost> {
  const lookup = new Map<string, RawPost>();
  for (const rawPost of Object.values(cache)) {
    if (!rawPost || typeof rawPost !== "object") continue;
    for (const key of rawPostLookupKeys(rawPost)) {
      const existing = lookup.get(key);
      if (!existing || rawPostRepairRank(rawPost) > rawPostRepairRank(existing)) {
        lookup.set(key, rawPost);
      }
    }
  }
  return lookup;
}

function rawPostRepairRank(post: RawPost): number {
  const directSourceUrl = isDirectThreadsPostUrl(post.source_url);
  const comments = Array.isArray(post.comments) ? post.comments.length : 0;
  const commentsWithMetrics = Array.isArray(post.comments)
    ? post.comments.filter(
        (comment) =>
          metricNumber(comment.like_count) > 0 ||
          metricNumber(comment.reply_count) > 0,
      ).length
    : 0;
  const commentsWithAvatars = Array.isArray(post.comments)
    ? post.comments.filter(
        (comment) =>
          Boolean(String(comment.avatar_asset_path ?? "").trim()) ||
          Boolean(String(comment.avatar_url ?? "").trim()),
      ).length
    : 0;
  const crawledAt = Date.parse(String(post.crawled_at ?? ""));
  const recency = Number.isFinite(crawledAt)
    ? Math.min(999_999_999, Math.max(0, Math.floor(crawledAt / 1000)))
    : 0;

  // A resolved share URL and its canonical post URL can coexist in cache.
  // Prefer the entry with the richest comment extraction, then the newest one.
  // A permalink crawl is authoritative for comment scope. A share alias can
  // have a larger, but unrelated, comment list for the same canonical post id.
  // Keep this preference ahead of the richness score so output repair cannot
  // replace a direct crawl with a stale share-cache record.
  return (
    (directSourceUrl ? 1_000_000_000_000_000 : 0) +
    comments * 1_000_000_000_000 +
    commentsWithMetrics * 1_000_000_000 +
    commentsWithAvatars * 1_000_000 +
    recency
  );
}

function isDirectThreadsPostUrl(value: unknown): boolean {
  return /https?:\/\/[^/]+\/@[^/]+\/post\/[A-Za-z0-9_-]+/i.test(
    String(value ?? "").trim(),
  );
}

function rawPostLookupKeys(rawPost: RawPost): string[] {
  const values = [
    String(rawPost.post_id ?? "").trim().toLowerCase(),
    String(rawPost.url ?? "").trim().toLowerCase(),
    String(rawPost.source_url ?? "").trim().toLowerCase(),
  ].filter(Boolean);
  return [...new Set(values)];
}

function findRawPost(
  rawLookup: Map<string, RawPost>,
  post: Pick<TopicData["posts"][number], "post_id" | "url" | "source_url">,
): RawPost | null {
  const candidates = [
    String(post.source_url ?? "").trim().toLowerCase(),
    String(post.url ?? "").trim().toLowerCase(),
    String(post.post_id ?? "").trim().toLowerCase(),
  ].filter(Boolean);
  for (const key of candidates) {
    const rawPost = rawLookup.get(key);
    if (rawPost) return rawPost;
  }
  return null;
}

function commentRepairDiffers(
  existingComments: unknown[],
  rebuiltComments: CommentData[],
): boolean {
  if (existingComments.length !== rebuiltComments.length) {
    return true;
  }

  for (let index = 0; index < rebuiltComments.length; index += 1) {
    const existing = existingComments[index];
    const rebuilt = rebuiltComments[index];
    if (!rebuilt || !isRecord(existing)) {
      return true;
    }
    if (
      String(existing.comment_id ?? "") !== rebuilt.comment_id ||
      String(existing.username ?? "") !== rebuilt.username ||
      String(existing.display_name ?? "") !== rebuilt.display_name ||
      String(existing.avatar_url ?? "") !== rebuilt.avatar_url ||
      String(existing.avatar_asset_path ?? "") !== rebuilt.avatar_asset_path ||
      String(existing.language ?? "") !== rebuilt.language ||
      String(existing.text ?? "") !== rebuilt.text ||
      Number(existing.like_count ?? 0) !== rebuilt.like_count ||
      Number(existing.reply_count ?? 0) !== rebuilt.reply_count ||
      Boolean(existing.is_reply) !== Boolean(rebuilt.is_reply) ||
      String(existing.created_at ?? "") !== rebuilt.created_at
    ) {
      return true;
    }
  }

  return false;
}

function mergeRepairedComments(
  existingComments: unknown[],
  rebuiltComments: CommentData[],
): Array<CommentData & Record<string, unknown>> {
  const existingById = new Map(
    existingComments
      .filter((comment): comment is RepairableRecord => isRecord(comment))
      .map((comment) => [String(comment.comment_id ?? ""), comment] as const),
  );

  return rebuiltComments.map((comment) => {
    const existing = existingById.get(comment.comment_id);
    const preserved = existing ? preserveCommentExtras(existing) : {};
    const existingMedia = existing && Array.isArray(existing.media) ? { media: existing.media } : {};
    return {
      ...preserved,
      ...comment,
      ...existingMedia,
    };
  });
}

function preserveCommentExtras(comment: RepairableRecord): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(comment)) {
    if (COMMENT_CANONICAL_KEYS.has(key)) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function mediaListsEqual(
  existing: unknown[],
  normalized: ReturnType<typeof normalizeRawMedia>,
): boolean {
  if (existing.length !== normalized.length) return false;
  return normalized.every((item, index) => {
    const current = existing[index];
    return (
      isRecord(current) &&
      String(current.asset_path ?? "") === item.asset_path &&
      String(current.remote_url ?? "") === item.remote_url &&
      String(current.type ?? "") === item.type &&
      Number(current.order ?? 0) === item.order &&
      Number(current.width ?? 0) === item.width &&
      Number(current.height ?? 0) === item.height
    );
  });
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim();
    if (normalized) {
      output.push(normalized);
    }
  }
  return output;
}

function isRecord(value: unknown): value is RepairableRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const COMMENT_CANONICAL_KEYS = new Set([
  "avatar_asset_path",
  "avatar_url",
  "comment_id",
  "created_at",
  "is_reply",
  "display_name",
  "language",
  "like_count",
  "media",
  "reply_count",
  "source_order",
  "text",
  "username",
]);
