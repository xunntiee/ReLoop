import type {
  CollectorStats,
  CommentData,
  CrawlRequest,
  CrawlRequestMeta,
  PartialTopicSnapshot,
  PostCollector,
  PostData,
  RawComment,
  RawPost,
  TopicData,
  TopicFilter,
} from "../types.js";
import { nowIso } from "../types.js";
import { buildPostMetricPeaks } from "../ranking/viral-score.js";
import {
  effectiveTopicGateScore,
  evaluateRawPostForOutput,
  resolveAcceptedPostSelectionStrategy,
  selectAcceptedPostResults,
} from "../selection/post-evaluation.js";
import { CrawlJsonWriter } from "../storage/json-writer.js";
import { slugifyAscii } from "../utils/text.js";

export class CrawlPipeline {
  constructor(
    private readonly collector: PostCollector,
    private readonly writer: CrawlJsonWriter,
  ) {}

  async run(request: CrawlRequest): Promise<string> {
    const topics: TopicData[] = [];
    for (const topicFilter of request.filters.topics) {
      let rawPosts: RawPost[] = [];
      let cancelledWithPartial = false;
      let partialSnapshot: PartialTopicSnapshot | null = null;
      try {
        rawPosts = await this.collector.collectPosts(topicFilter);
      } catch (error) {
        if (!isCollectorCancelledError(error)) {
          throw error;
        }
        partialSnapshot =
          this.collector.getPartialSnapshot?.(topicFilter) ?? {
            posts: this.collector.getPartialPosts?.(topicFilter) ?? [],
          };
        rawPosts = partialSnapshot.posts;
        const hasResumeSeeds = (partialSnapshot.resumeSeedUrls ?? []).length > 0;
        if (rawPosts.length === 0 && topics.length === 0 && !hasResumeSeeds) {
          throw error;
        }
        cancelledWithPartial = true;
      }
      topics.push(
        buildTopicDataFromRawPosts({
          collectorAudit: this.collector.getAuditSnapshot?.(topicFilter),
          collectorStats: this.collector.stats,
          partialSnapshot: cancelledWithPartial ? partialSnapshot : null,
          rawPosts,
          request,
          topicFilter,
        }),
      );
      if (cancelledWithPartial) {
        break;
      }
    }
    return this.writer.writeTopics(topics, `${request.request_id}.json`);
  }

}

export function buildTopicDataFromRawPosts({
  collectorAudit,
  collectorStats,
  partialSnapshot,
  rawPosts,
  request,
  topicFilter,
}: {
  collectorAudit?: Record<string, unknown>;
  collectorStats?: CollectorStats;
  partialSnapshot?: PartialTopicSnapshot | null;
  rawPosts: RawPost[];
  request: CrawlRequest;
  topicFilter: TopicFilter;
}): TopicData {
  const { posts, audit } = buildPostsForTopic(rawPosts, topicFilter, request);
  audit.collector_stats = collectorStats ? { ...collectorStats } : {};
  if (collectorAudit && Object.keys(collectorAudit).length > 0) {
    audit.collector_pipeline = collectorAudit;
  }
  if (collectorStats) {
    audit.collector_breakdown = {
      discovered_urls: collectorStats.discovered_urls,
      summary_candidates: collectorStats.summary_candidates,
      summary_collected: collectorStats.summary_collected,
      detail_reserved: collectorStats.detail_reserved,
      detail_opened: collectorStats.detail_opened,
      detail_valid: collectorStats.detail_valid,
      final_selected: collectorStats.final_selected,
      skipped_after_target: collectorStats.skipped_after_target,
      invalid_urls: collectorStats.invalid_urls,
      cache_hits: collectorStats.cache_hits,
      cache_misses: collectorStats.cache_misses,
    };
  }
  if (collectorStats?.skipped_samples?.length) {
    audit.collector_skipped_samples = collectorStats.skipped_samples;
    audit.collector_skip_reasons = collectorStats.skipped_samples.reduce<Record<string, number>>(
      (counts, sample) => {
        const reason = String(sample.reason || "unknown");
        counts[reason] = (counts[reason] ?? 0) + 1;
        return counts;
      },
      {},
    );
  }

  const acceptedPostUrlSet = new Set(
    posts
      .map((post) => String(post.url ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const normalizedSnapshot = normalizePartialSnapshot(partialSnapshot, rawPosts);
  if (isPartialSnapshotCheckpoint(normalizedSnapshot)) {
    audit.partial_output = true;
    if (normalizedSnapshot.resumeSeedUrls.length > 0) {
      audit.resume_seed_urls = normalizedSnapshot.resumeSeedUrls;
    }
    if (normalizedSnapshot.completedPostUrls.length > 0) {
      audit.completed_post_urls = normalizedSnapshot.completedPostUrls.filter((url) =>
        acceptedPostUrlSet.has(url.trim().toLowerCase()),
      );
    }
    if (normalizedSnapshot.previewOnlyPostUrls.length > 0) {
      audit.preview_only_post_urls = normalizedSnapshot.previewOnlyPostUrls.filter((url) =>
        acceptedPostUrlSet.has(url.trim().toLowerCase()),
      );
    }
    if (normalizedSnapshot.pendingPostUrls.length > 0) {
      audit.pending_post_urls = normalizedSnapshot.pendingPostUrls;
    }
    if (normalizedSnapshot.processedPostUrls.length > 0) {
      audit.processed_post_urls = normalizedSnapshot.processedPostUrls;
    }
  }

  return {
    topic_id: `topic-${slugifyAscii(topicFilter.topic_title, "topic")}`,
    topic_title: topicFilter.topic_title,
    keywords: topicFilter.keywords,
    source: request.filters.source,
    crawled_at: nowIso(),
    request_meta: buildRequestMeta(request, topicFilter),
    crawl_audit: audit,
    posts,
  };
}

function isCollectorCancelledError(error: unknown): boolean {
  return error instanceof Error && error.name === "CrawlCancelledError";
}

function buildPostsForTopic(
  rawPosts: RawPost[],
  topicFilter: TopicFilter,
  request: CrawlRequest,
): {
  posts: PostData[];
  audit: Record<string, unknown>;
} {
  const scoredPosts: Array<{ post: PostData; score: number; scoreBreakdown: Record<string, unknown> }> = [];
  const audit = newAudit(rawPosts.length);
  const metricPeaks = buildPostMetricPeaks(rawPosts, request.created_at);
  audit.topic_gate_score = effectiveTopicGateScore(
    topicFilter,
    request.filters.min_topic_match_score,
  );

  for (const rawPost of rawPosts) {
    const evaluated = evaluateRawPostForOutput(rawPost, topicFilter, request, {
      metricPeaks,
    });
    mergeCommentAudit(audit, evaluated.commentAudit);
    if (!evaluated.accepted) {
      recordPostRejection(audit, evaluated.reason, rawPost, {
        ...evaluated.match,
        matched_excluded_keyword_sources:
          evaluated.filterAnalysis?.matched_excluded_keyword_sources ?? [],
        matched_excluded_keywords:
          evaluated.filterAnalysis?.matched_excluded_keywords ?? [],
        matched_link_patterns:
          evaluated.filterAnalysis?.matched_link_patterns ?? [],
        matched_required_keywords:
          evaluated.filterAnalysis?.matched_required_keywords ?? [],
        missing_required_keywords:
          evaluated.filterAnalysis?.missing_required_keywords ?? [],
        required_keywords_mode:
          evaluated.filterAnalysis?.required_keywords_mode ?? "all",
        score: evaluated.match?.score ?? 0,
      });
      continue;
    }

    scoredPosts.push({
      post: evaluated.post,
      score: evaluated.score,
      scoreBreakdown: evaluated.scoreBreakdown,
    });
  }

  const selectionStrategy = resolveAcceptedPostSelectionStrategy(topicFilter, {
    dateRange: request.filters.date_range,
    sortBy: request.filters.sort_by,
  });
  const selectedPosts = selectAcceptedPostResults(scoredPosts, {
    limit: request.filters.max_posts_per_topic,
    referenceTime: request.created_at,
    sortBy: request.filters.sort_by,
    rankingMode: request.filters.ranking_mode,
    strategy: selectionStrategy,
  });
  const posts = selectedPosts.map((item) => item.post);
  audit.accepted_posts = posts.length;
  audit.accepted_before_limit = scoredPosts.length;
  audit.limited_out_posts = Math.max(0, scoredPosts.length - posts.length);
  audit.rejection_labels = buildRejectionLabels(audit.rejection_counts);
  audit.top_rejection_reasons = buildTopRejectionReasons(audit.rejection_counts);
  audit.ranking_mode = request.filters.ranking_mode;
  audit.ranking_weights = { ...request.filters.ranking_weights };
  audit.sort_by = request.filters.sort_by;
  audit.selection_strategy = selectionStrategy;
  if (selectionStrategy === "score_then_time_window_spread") {
    audit.selected_time_bucket_counts = buildTimeBucketCounts(posts, request.created_at);
  } else if (selectionStrategy === "score_then_day_spread") {
    audit.selected_date_bucket_counts = buildDateBucketCounts(posts);
  }
  return { posts, audit };
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of urls) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function normalizePartialSnapshot(
  snapshot: PartialTopicSnapshot | null | undefined,
  rawPosts: RawPost[],
): {
  completedPostUrls: string[];
  pendingPostUrls: string[];
  previewOnlyPostUrls: string[];
  processedPostUrls: string[];
  resumeSeedUrls: string[];
} {
  if (!snapshot) {
    return {
      completedPostUrls: [],
      pendingPostUrls: [],
      previewOnlyPostUrls: [],
      processedPostUrls: [],
      resumeSeedUrls: [],
    };
  }

  const resumeSeedUrls = dedupeUrls(
    snapshot?.resumeSeedUrls?.length
      ? snapshot.resumeSeedUrls
      : rawPosts.map((post) => String(post.url ?? post.source_url ?? "").trim()),
  );
  const completedPostUrls = dedupeUrls(snapshot?.completedPostUrls ?? []);
  const previewOnlyPostUrls = dedupeUrls(snapshot?.previewOnlyPostUrls ?? []);
  const completedSet = new Set(completedPostUrls.map((url) => url.trim().toLowerCase()));
  const pendingPostUrls = dedupeUrls([
    ...(snapshot?.pendingPostUrls ?? []),
    ...resumeSeedUrls.filter((url) => !completedSet.has(url.trim().toLowerCase())),
  ]);
  const processedPostUrls = dedupeUrls(snapshot?.processedPostUrls ?? []);

  return {
    completedPostUrls,
    pendingPostUrls,
    previewOnlyPostUrls,
    processedPostUrls,
    resumeSeedUrls,
  };
}

function isPartialSnapshotCheckpoint(snapshot: {
  completedPostUrls: string[];
  pendingPostUrls: string[];
  previewOnlyPostUrls: string[];
  processedPostUrls: string[];
  resumeSeedUrls: string[];
}): boolean {
  return (
    snapshot.pendingPostUrls.length > 0 ||
    snapshot.previewOnlyPostUrls.length > 0 ||
    (snapshot.completedPostUrls.length === 0 && snapshot.resumeSeedUrls.length > 0) ||
    (snapshot.processedPostUrls.length > snapshot.completedPostUrls.length)
  );
}

function buildDateBucketCounts(posts: PostData[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const post of posts) {
    const bucket = createdAtDayBucket(post.created_at);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

function buildTimeBucketCounts(posts: PostData[], referenceTime: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const post of posts) {
    const bucket = createdAtTimeBucket(post.created_at, referenceTime);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

function createdAtDayBucket(createdAt: string): string {
  const value = String(createdAt || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "unknown-date";
  }
  return parsed.toISOString().slice(0, 10);
}

function createdAtTimeBucket(createdAt: string, referenceTime: string): string {
  const created = new Date(String(createdAt || "").trim());
  const reference = new Date(String(referenceTime || "").trim());
  if (Number.isNaN(created.getTime()) || Number.isNaN(reference.getTime())) {
    return "unknown-date";
  }
  const ageDays = Math.max(0, Math.floor((reference.getTime() - created.getTime()) / 86_400_000));
  if (ageDays <= 1) return "d00_01";
  if (ageDays <= 4) return "d02_04";
  if (ageDays <= 9) return "d05_09";
  if (ageDays <= 16) return "d10_16";
  if (ageDays <= 30) return "d17_30";
  if (ageDays <= 60) return "d31_60";
  if (ageDays <= 120) return "d61_120";
  return "d121_plus";
}

function buildRequestMeta(request: CrawlRequest, topicFilter: TopicFilter): CrawlRequestMeta {
  return {
    created_at: request.created_at,
    date_range: { ...request.filters.date_range },
    languages: [...request.filters.languages],
    include_usernames: [...request.filters.include_usernames],
    exclude_usernames: [...request.filters.exclude_usernames],
    text_contains_any: [...request.filters.text_contains_any],
    text_contains_all: [...request.filters.text_contains_all],
    text_excludes_any: [...request.filters.text_excludes_any],
    global_excluded_keywords: [...request.filters.global_excluded_keywords],
    exclude_posts_with_links: request.filters.exclude_posts_with_links,
    exclude_commerce_content: request.filters.exclude_commerce_content,
    min_post_likes: request.filters.min_post_likes,
    min_post_views: request.filters.min_post_views,
    min_post_replies: request.filters.min_post_replies,
    min_post_reposts: request.filters.min_post_reposts,
    min_post_shares: request.filters.min_post_shares,
    require_repost_or_share: request.filters.require_repost_or_share,
    min_post_score: request.filters.min_post_score,
    min_topic_match_score: request.filters.min_topic_match_score,
    min_comment_likes: request.filters.min_comment_likes,
    min_text_length: request.filters.min_text_length,
    max_text_length: request.filters.max_text_length,
    min_comments: request.filters.min_comments,
    min_loaded_top_comments: request.filters.min_loaded_top_comments,
    require_comments: request.filters.require_comments,
    require_metrics: request.filters.require_metrics,
    max_posts_per_topic: request.filters.max_posts_per_topic,
    notes: request.notes,
    recency_half_life_hours: request.filters.recency_half_life_hours,
    request_id: request.request_id,
    ranking_mode: request.filters.ranking_mode,
    ranking_weights: { ...request.filters.ranking_weights },
    runtime_overrides: request.runtime_overrides ? { ...request.runtime_overrides } : undefined,
    sort_by: request.filters.sort_by,
    source: request.filters.source,
    top_comments_per_post: request.filters.top_comments_per_post,
    topic: {
      category: topicFilter.category,
      excluded_keywords: [...topicFilter.excluded_keywords],
      keywords: [...topicFilter.keywords],
      lexicon: {
        abbreviations: [...topicFilter.lexicon.abbreviations],
        canonical: [...topicFilter.lexicon.canonical],
        no_diacritics: [...topicFilter.lexicon.no_diacritics],
        teencode: [...topicFilter.lexicon.teencode],
      },
      query_variants: [...topicFilter.query_variants],
      required_keywords: [...topicFilter.required_keywords],
      required_keywords_mode: topicFilter.required_keywords_mode,
      search_queries: [...topicFilter.search_queries],
      seed_post_urls: [...topicFilter.seed_post_urls],
      trend_search_urls: [...(topicFilter.trend_search_urls ?? [])],
      topic_intent: topicFilter.topic_intent,
      topic_title: topicFilter.topic_title,
    },
    ui_state: request.ui_state ? { ...request.ui_state } : undefined,
  };
}

function newAudit(rawPosts: number): Record<string, unknown> {
  return {
    raw_posts: rawPosts,
    accepted_posts: 0,
    accepted_before_limit: 0,
    limited_out_posts: 0,
    rejected_posts: 0,
    rejection_counts: {},
    rejection_samples: [],
    comments_seen: 0,
    comments_accepted: 0,
    comments_rejected: 0,
    comments_before_limit: 0,
    comments_limited_out: 0,
    comment_rejection_counts: {},
  };
}

function recordPostRejection(
  audit: Record<string, unknown>,
  reason: string,
  rawPost: RawPost,
  _match?: {
    matched_excluded_keyword_sources?: unknown;
    matched_excluded_keywords?: unknown;
    matched_link_patterns?: unknown;
    matched_keywords?: unknown;
    matched_lexicon?: unknown;
    matched_required_keywords?: unknown;
    missing_required_keywords?: unknown;
    required_keywords_mode?: unknown;
    score?: unknown;
  },
): void {
  audit.rejected_posts = intValue(audit.rejected_posts) + 1;
  const counts = audit.rejection_counts as Record<string, number>;
  counts[reason] = (counts[reason] ?? 0) + 1;

  const samples = audit.rejection_samples as Record<string, unknown>[];
  if (samples.length >= 20) return;
  samples.push({
    reason,
    reason_label: humanizeRejectionReason(reason),
    post_id: String(rawPost.post_id ?? ""),
    username: String(rawPost.username ?? ""),
    url: String(rawPost.url ?? ""),
    matched_query: String(rawPost.matched_query ?? ""),
    language: String(rawPost.language ?? ""),
    created_at: String(rawPost.created_at ?? ""),
    view_count: intValue(rawPost.view_count),
    like_count: intValue(rawPost.like_count),
    reply_count: intValue(rawPost.reply_count),
    repost_count: intValue(rawPost.repost_count),
    quote_count: intValue(rawPost.quote_count),
    share_count: intValue(rawPost.share_count),
    topic_match_score: Number(_match?.score ?? 0),
    matched_keywords: _match?.matched_keywords ?? [],
    matched_lexicon: _match?.matched_lexicon ?? [],
    matched_required_keywords: _match?.matched_required_keywords ?? [],
    missing_required_keywords: _match?.missing_required_keywords ?? [],
    required_keywords_mode: String(_match?.required_keywords_mode ?? "all"),
    matched_excluded_keywords: _match?.matched_excluded_keywords ?? [],
    matched_excluded_keyword_sources: _match?.matched_excluded_keyword_sources ?? [],
    matched_link_patterns: _match?.matched_link_patterns ?? [],
    text_preview: String(rawPost.text ?? "").slice(0, 180),
  });
}

function buildRejectionLabels(value: unknown): Record<string, string> {
  const counts = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.keys(counts).map((reason) => [reason, humanizeRejectionReason(reason)]),
  );
}

function buildTopRejectionReasons(
  value: unknown,
): Array<{ count: number; label: string; reason: string }> {
  const counts = isRecord(value) ? value : {};
  return Object.entries(counts)
    .map(([reason, count]) => ({
      count: intValue(count),
      label: humanizeRejectionReason(reason),
      reason,
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);
}

function humanizeRejectionReason(reason: string): string {
  switch (reason) {
    case "viral_signal_too_weak":
      return "Tín hiệu viral chưa đủ mạnh";
    case "viral_content_quality_too_low":
      return "Nội dung không phù hợp viral feed";
    case "topic_match_below_minimum":
      return "Không khớp chủ đề";
    case "not_enough_loaded_top_comments":
      return "Chưa lấy đủ comment nổi bật";
    case "post_has_link":
      return "Bài có link";
    case "commerce_content":
    case "commerce_content_detected":
      return "Nội dung bán hàng/quảng cáo";
    case "missing_text":
      return "Thiếu nội dung text";
    case "missing_post_id":
      return "Thiếu ID bài viết";
    case "language_not_allowed":
      return "Sai ngôn ngữ";
    case "below_min_views":
      return "Lượt xem thấp";
    case "below_min_likes":
      return "Lượt thích thấp";
    case "below_min_comments":
      return "Bình luận thấp";
    case "below_min_score":
      return "Điểm viral thấp";
    case "text_too_short":
      return "Text quá ngắn";
    case "text_too_long":
      return "Text quá dài";
    default:
      return reason.replace(/_/g, " ");
  }
}

function mergeCommentAudit(audit: Record<string, unknown>, commentAudit: Record<string, unknown>): void {
  for (const key of ["comments_seen", "comments_accepted", "comments_rejected", "comments_before_limit", "comments_limited_out"]) {
    audit[key] = intValue(audit[key]) + intValue(commentAudit[key]);
  }

  const outputCounts = audit.comment_rejection_counts as Record<string, number>;
  const inputCounts = isRecord(commentAudit.comment_rejection_counts) ? commentAudit.comment_rejection_counts : {};
  for (const [reason, count] of Object.entries(inputCounts)) {
    outputCounts[reason] = (outputCounts[reason] ?? 0) + intValue(count);
  }
}

function intValue(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
