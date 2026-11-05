import { readFileSync } from "node:fs";
import { z } from "zod";
import type { CrawlFilters, CrawlRequest, DateRangeFilter, RankingWeights, TopicFilter, TopicLexicon } from "../types.js";
import { nowIso } from "../types.js";

const looseObject = z.record(z.string(), z.unknown());

export function loadCrawlRequest(configPath: string): CrawlRequest {
  const payload = looseObject.parse(JSON.parse(readFileSync(configPath, "utf8")));
  const rawFilters = asRecord(payload.filters);
  const rawDateRange = asRecord(rawFilters.date_range);

  const topics = asList(rawFilters.topics)
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item): TopicFilter => ({
      topic_title: asString(item.topic_title).trim(),
      topic_intent: asString(item.topic_intent).trim() || asString(item.topic_title).trim(),
      category: asString(item.category).trim(),
      keywords: stringList(item.keywords),
      search_queries: stringList(item.search_queries),
      query_variants: stringList(item.query_variants),
      required_keywords: stringList(item.required_keywords),
      required_keywords_mode: asRequiredKeywordsMode(item.required_keywords_mode),
      excluded_keywords: stringList(item.excluded_keywords),
      lexicon: topicLexicon(item.lexicon),
      seed_post_urls: stringList(item.seed_post_urls),
      trend_search_urls: stringList(item.trend_search_urls),
    }))
    .filter((topic) => topic.topic_title.length > 0);

  const filters: CrawlFilters = {
    topics,
    date_range: {
      start_date: asString(rawDateRange.start_date).trim(),
      end_date: asString(rawDateRange.end_date).trim(),
      preset: asString(rawDateRange.preset).trim(),
      timezone: asString(rawDateRange.timezone).trim(),
    } satisfies DateRangeFilter,
    languages: stringList(rawFilters.languages, ["vi"]),
    include_usernames: stringList(rawFilters.include_usernames).map((value) => value.replace(/^@/, "").toLowerCase()),
    exclude_usernames: stringList(rawFilters.exclude_usernames).map((value) => value.replace(/^@/, "").toLowerCase()),
    text_contains_any: stringList(rawFilters.text_contains_any),
    text_contains_all: stringList(rawFilters.text_contains_all),
    text_excludes_any: stringList(rawFilters.text_excludes_any),
    global_excluded_keywords: stringList(rawFilters.global_excluded_keywords),
    exclude_posts_with_links: asBool(rawFilters.exclude_posts_with_links, true),
    exclude_commerce_content: asBool(rawFilters.exclude_commerce_content, true),
    min_post_likes: asInt(rawFilters.min_post_likes),
    min_post_views: asInt(rawFilters.min_post_views),
    min_post_replies: asInt(rawFilters.min_post_replies),
    min_post_reposts: asInt(rawFilters.min_post_reposts),
    min_post_shares: asInt(rawFilters.min_post_shares),
    require_repost_or_share: asBool(rawFilters.require_repost_or_share),
    min_post_score: asFloat(rawFilters.min_post_score),
    min_topic_match_score: asFloat(rawFilters.min_topic_match_score),
    min_comment_likes: asInt(rawFilters.min_comment_likes),
    min_text_length: asInt(rawFilters.min_text_length),
    max_text_length: asInt(rawFilters.max_text_length),
    min_comments: asInt(rawFilters.min_comments),
    min_loaded_top_comments: asInt(rawFilters.min_loaded_top_comments),
    require_comments: asBool(rawFilters.require_comments),
    require_metrics: asBool(rawFilters.require_metrics),
    recency_half_life_hours: asFloat(rawFilters.recency_half_life_hours, 168),
    max_posts_per_topic: asInt(rawFilters.max_posts_per_topic, 20),
    top_comments_per_post: asInt(rawFilters.top_comments_per_post, 5),
    ranking_mode: asRankingMode(rawFilters.ranking_mode),
    ranking_weights: rankingWeights(rawFilters.ranking_weights),
    sort_by: asString(rawFilters.sort_by).trim() || "score",
    source: asString(rawFilters.source).trim() || "threads",
  };

  return {
    request_id: asString(payload.request_id).trim() || configPath.replace(/^.*[\\/]/, "").replace(/\.json$/i, ""),
    filters,
    created_at: asString(payload.created_at).trim() || nowIso(),
    notes: asString(payload.notes).trim(),
  };
}

function stringList(value: unknown, fallback: string[] = []): string[] {
  const items = asList(value).map((item) => String(item).trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asBool(value: unknown, fallback = false): boolean {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function asInt(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asFloat(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asRequiredKeywordsMode(value: unknown): "all" | "any" {
  return String(value ?? "").trim().toLowerCase() === "any" ? "any" : "all";
}

function asRankingMode(value: unknown): "sort_by" | "weighted" {
  return String(value ?? "").trim().toLowerCase() === "sort_by" ? "sort_by" : "weighted";
}

function topicLexicon(value: unknown): TopicLexicon {
  const record = asRecord(value);
  return {
    canonical: stringList(record.canonical),
    abbreviations: stringList(record.abbreviations),
    teencode: stringList(record.teencode),
    no_diacritics: stringList(record.no_diacritics),
  };
}

function rankingWeights(value: unknown): RankingWeights {
  const record = asRecord(value);
  return {
    comments: asFloat(record.comments, 16),
    likes: asFloat(record.likes, 14),
    recency: asFloat(record.recency, 8),
    reposts: asFloat(record.reposts, 24),
    shares: asFloat(record.shares, 22),
    topic_match: asFloat(record.topic_match, 8),
    views: asFloat(record.views, 8),
  };
}
