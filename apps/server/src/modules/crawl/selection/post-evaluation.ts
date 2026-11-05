import type {
  CommentData,
  CrawlRequest,
  PostData,
  RawComment,
  RawPost,
  TopicFilter,
  TopicMatch,
} from "../types.js";
import { sanitizeCachedCommentText } from "../collectors/threads-parsing.js";
import { evaluateTopicMatch } from "../ranking/topic-match.js";
import {
  analyzePostFilters,
  commentFilterRejectionReason,
  type PostFilterAnalysis,
} from "../ranking/post-filters.js";
import {
  buildPostMetricPeaks,
  computeEngagementScore,
  computePostScoreBreakdown,
  type PostMetricPeaks,
} from "../ranking/viral-score.js";
import { mediaAssetIdentityKey } from "../collectors/threads-media.js";
import { buildPublishTimeMetadata } from "../utils/date-range.js";

export type AcceptedPostEvaluation = {
  accepted: true;
  bypassTopicGate: boolean;
  commentAudit: Record<string, unknown>;
  match: TopicMatch;
  post: PostData;
  rawPost: RawPost;
  score: number;
  scoreBreakdown: Record<string, number>;
};

export type RejectedPostEvaluation = {
  accepted: false;
  bypassTopicGate: boolean;
  commentAudit: Record<string, unknown>;
  filterAnalysis?: PostFilterAnalysis;
  match?: TopicMatch;
  rawPost: RawPost;
  reason: string;
  score?: number;
  scoreBreakdown?: Record<string, number>;
};

export type PostEvaluationResult =
  | AcceptedPostEvaluation
  | RejectedPostEvaluation;

export type AcceptedPostSelectionStrategy =
  | "top_score"
  | "score_then_day_spread"
  | "score_then_time_window_spread";

export const STRICT_BLANK_VIRAL_MIN_SCORE = 60;

export interface OutputCommentSelectionOptions {
  languages?: string[];
  min_comment_likes?: number;
  top_comments_per_post?: number;
}

export function evaluateRawPostForOutput(
  rawPost: RawPost,
  topicFilter: TopicFilter,
  request: CrawlRequest,
  options: {
    metricPeaks?: PostMetricPeaks;
    skipLoadedCommentGate?: boolean;
    skipScoreGate?: boolean;
    viralScoreFloorOverride?: number;
  } = {},
): PostEvaluationResult {
  if (!String(rawPost.post_id ?? "").trim()) {
    return rejected(rawPost, "missing_post_id");
  }
  if (!String(rawPost.text ?? "").trim()) {
    return rejected(rawPost, "missing_text");
  }

  const match = evaluateTopicMatch(rawPost, topicFilter);
  const bypassTopicGate = seedUrlBypassesTopicGate(rawPost, topicFilter);
  const topicGateScore = effectiveTopicGateScore(
    topicFilter,
    request.filters.min_topic_match_score,
  );
  if (!bypassTopicGate && match.score < topicGateScore) {
    return rejected(rawPost, "topic_match_below_minimum", {
      bypassTopicGate,
      match,
    });
  }
  if (
    shouldEnforceImplicitViralSignalFloor(topicFilter, request) &&
    !meetsImplicitViralSignalFloor(rawPost, request.created_at)
  ) {
    return rejected(rawPost, "viral_signal_too_weak", {
      bypassTopicGate,
      match,
    });
  }
  if (
    shouldEnforceImplicitViralSignalFloor(topicFilter, request) &&
    !meetsImplicitViralContentQuality(rawPost)
  ) {
    return rejected(rawPost, "viral_content_quality_too_low", {
      bypassTopicGate,
      match,
    });
  }

  const metricPeaks =
    options.metricPeaks ?? buildPostMetricPeaks([rawPost], request.created_at);
  const scoreBreakdown = computePostScoreBreakdown(rawPost, {
    matchScore: match.score,
    metricPeaks,
    rankingMode: request.filters.ranking_mode,
    rankingWeights: request.filters.ranking_weights,
    referenceTime: request.created_at,
    recencyHalfLifeHours: request.filters.recency_half_life_hours,
    sortBy: request.filters.sort_by,
  });
  const score = Number(scoreBreakdown.final_score ?? 0);
  const enforceImplicitViralFloor = shouldEnforceImplicitViralSignalFloor(
    topicFilter,
    request,
  );
  const effectiveFilters = options.skipScoreGate
    ? { ...request.filters, min_post_score: 0 }
    : enforceImplicitViralFloor
      ? {
          ...request.filters,
          min_post_score: Math.max(
            STRICT_BLANK_VIRAL_MIN_SCORE,
            Number(options.viralScoreFloorOverride ?? 0),
            Number(request.filters.min_post_score) || 0,
          ),
        }
      : request.filters;
  const filterAnalysis = analyzePostFilters(
    rawPost,
    topicFilter,
    effectiveFilters,
    score,
    request.created_at,
    { skipLanguageGate: isDirectPostSeedTopic(topicFilter) },
  );
  if (filterAnalysis.reason) {
    return rejected(rawPost, filterAnalysis.reason, {
      bypassTopicGate,
      filterAnalysis,
      match,
      score,
      scoreBreakdown,
    });
  }

  const { comments, audit: commentAudit } = buildComments(rawPost, request);
  if (
    !options.skipLoadedCommentGate &&
    request.filters.min_loaded_top_comments &&
    comments.length < request.filters.min_loaded_top_comments
  ) {
    return rejected(rawPost, "not_enough_loaded_top_comments", {
      bypassTopicGate,
      commentAudit,
      filterAnalysis,
      match,
      score,
      scoreBreakdown,
    });
  }

  return {
    accepted: true,
    bypassTopicGate,
    commentAudit,
    match,
    post: {
      post_id: String(rawPost.post_id ?? ""),
      url: String(rawPost.url ?? ""),
      username: String(rawPost.username ?? ""),
      display_name: String(rawPost.display_name ?? ""),
      avatar_url: String(rawPost.avatar_url ?? ""),
      avatar_asset_path: String(rawPost.avatar_asset_path ?? ""),
      text: String(rawPost.text ?? ""),
      source_url: String(rawPost.source_url ?? ""),
      language: String(rawPost.language ?? ""),
      view_count: intValue(rawPost.view_count),
      like_count: intValue(rawPost.like_count),
      reply_count: intValue(rawPost.reply_count),
      repost_count: intValue(rawPost.repost_count),
      quote_count: intValue(rawPost.quote_count),
      share_count: intValue(rawPost.share_count),
      created_at: String(rawPost.created_at ?? ""),
      publish_time: buildPublishTimeMetadata({
        createdAt: rawPost.created_at,
        dateRange: request.filters.date_range,
        referenceTime: request.created_at,
        source: String(rawPost.created_at_source ?? ""),
      }),
      crawled_at: String(rawPost.crawled_at ?? ""),
      discovery_source: String(rawPost.discovery_source ?? ""),
      discovery_window_end: String(rawPost.discovery_window_end ?? ""),
      discovery_window_start: String(rawPost.discovery_window_start ?? ""),
      matched_query: String(rawPost.matched_query ?? ""),
      media: normalizeMedia(rawPost.media),
      ranking: {
        breakdown: scoreBreakdown,
        final_score: score,
        mode: request.filters.ranking_mode,
        sort_by: request.filters.sort_by,
      },
      top_comments: comments,
    },
    rawPost,
    score,
    scoreBreakdown,
  };
}

export function sortAcceptedPostResults(
  posts: Array<{
    post: PostData;
    score: number;
    scoreBreakdown: Record<string, unknown>;
  }>,
  sortBy: string,
  rankingMode: string,
): void {
  if ((rankingMode || "").trim().toLowerCase() === "weighted") {
    posts.sort(
      (a, b) =>
        b.score - a.score ||
        b.post.view_count - a.post.view_count ||
        b.post.reply_count - a.post.reply_count ||
        b.post.repost_count - a.post.repost_count ||
        b.post.like_count - a.post.like_count,
    );
    return;
  }

  const key = (sortBy || "views").trim().toLowerCase();
  if (["newest", "latest", "created_at", "date"].includes(key)) {
    posts.sort(
      (a, b) => dateValue(b.post.created_at) - dateValue(a.post.created_at) || b.score - a.score,
    );
  } else if (["likes", "like_count"].includes(key)) {
    posts.sort((a, b) => b.post.like_count - a.post.like_count || b.score - a.score);
  } else if (["comments", "replies", "reply_count"].includes(key)) {
    posts.sort((a, b) => b.post.reply_count - a.post.reply_count || b.score - a.score);
  } else if (["reposts", "repost_count"].includes(key)) {
    posts.sort((a, b) => b.post.repost_count - a.post.repost_count || b.score - a.score);
  } else if (["quotes", "quote_count"].includes(key)) {
    posts.sort((a, b) => b.post.quote_count - a.post.quote_count || b.score - a.score);
  } else if (["shares", "share_count"].includes(key)) {
    posts.sort((a, b) => b.post.share_count - a.post.share_count || b.score - a.score);
  } else if (["views", "view_count"].includes(key)) {
    posts.sort((a, b) => b.post.view_count - a.post.view_count || b.score - a.score);
  } else if (["engagement", "engagement_score"].includes(key)) {
    posts.sort(
      (a, b) =>
        Number(b.scoreBreakdown.engagement_score ?? 0) -
          Number(a.scoreBreakdown.engagement_score ?? 0) ||
        b.score - a.score,
    );
  } else {
    posts.sort((a, b) => b.score - a.score);
  }
}

export function selectAcceptedPostResults<
  TEntry extends {
    post: PostData;
    score: number;
    scoreBreakdown: Record<string, unknown>;
  },
>(
  posts: TEntry[],
  options: {
    limit: number;
    maxPostsPerAuthor?: number;
    maxPostsPerSource?: Record<string, number>;
    relaxSourceCaps?: boolean;
    referenceTime?: string;
    sortBy: string;
    rankingMode: string;
    strategy?: AcceptedPostSelectionStrategy;
  },
): TEntry[] {
  const ranked = [...posts];
  sortAcceptedPostResults(ranked, options.sortBy, options.rankingMode);
  const limit = Math.max(1, Math.trunc(options.limit || 1));
  const maxPostsPerAuthor = Math.max(0, Math.trunc(options.maxPostsPerAuthor || 0));
  const sourceCaps = Object.fromEntries(
    Object.entries(options.maxPostsPerSource ?? {})
      .map(([source, cap]) => [source.trim().toLowerCase(), Math.max(0, Math.trunc(cap || 0))])
      .filter(([source, cap]) => Boolean(source) && Number(cap) > 0),
  ) as Record<string, number>;
  const hasSourceCaps = Object.keys(sourceCaps).length > 0;
  const strategy = options.strategy ?? "top_score";
  let selected: TEntry[];
  if (strategy === "top_score" || ranked.length <= limit || limit <= 1) {
    selected = ranked.slice(0, limit);
  } else if (strategy === "score_then_time_window_spread") {
    selected = spreadRankedPostsAcrossTimeWindows(ranked, limit, options.referenceTime);
  } else {
    selected = spreadRankedPostsAcrossDays(ranked, limit);
  }
  if (maxPostsPerAuthor <= 0 && !hasSourceCaps) return selected;

  const selectedKeys = new Set<TEntry>();
  const authorCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const diverse: TEntry[] = [];
  const tryAdd = (
    entry: TEntry,
    constraints: { enforceAuthor: boolean; enforceSource: boolean },
  ): void => {
    if (diverse.length >= limit || selectedKeys.has(entry)) return;
    const author = normalizeForQuality(entry.post.username) || `post:${entry.post.post_id}`;
    const source = String(entry.post.discovery_source || "unknown").trim().toLowerCase() || "unknown";
    const authorCount = authorCounts.get(author) ?? 0;
    const sourceCount = sourceCounts.get(source) ?? 0;
    const sourceCap = sourceCaps[source];
    if (
      constraints.enforceAuthor &&
      maxPostsPerAuthor > 0 &&
      authorCount >= maxPostsPerAuthor
    ) return;
    if (
      constraints.enforceSource &&
      sourceCap !== undefined &&
      sourceCount >= sourceCap
    ) return;
    authorCounts.set(author, authorCount + 1);
    sourceCounts.set(source, sourceCount + 1);
    selectedKeys.add(entry);
    diverse.push(entry);
  };

  for (const entry of [...selected, ...ranked]) {
    tryAdd(entry, { enforceAuthor: true, enforceSource: true });
  }
  if (options.relaxSourceCaps !== false) {
    for (const entry of ranked) {
      tryAdd(entry, { enforceAuthor: true, enforceSource: false });
    }
  }
  for (const entry of ranked) {
    tryAdd(entry, {
      enforceAuthor: false,
      enforceSource: options.relaxSourceCaps === false,
    });
  }
  return diverse;
}
export function resolveAcceptedPostSelectionStrategy(
  topic:
    | Pick<
        TopicFilter,
        | "topic_title"
        | "topic_intent"
        | "keywords"
        | "query_variants"
        | "required_keywords"
        | "search_queries"
        | "seed_post_urls"
      >
    | undefined,
  options: {
    dateRange?: {
      end_date?: string;
      preset?: string;
      start_date?: string;
    };
    sortBy?: string;
  } = {},
): AcceptedPostSelectionStrategy {
  if (!topic) return "top_score";
  const sortKey = String(options.sortBy || "score").trim().toLowerCase();
  if (["newest", "latest", "created_at", "date"].includes(sortKey)) {
    return "top_score";
  }
  const title = normalizeLooseLabel(topic.topic_title);
  const intent = normalizeLooseLabel(topic.topic_intent);
  const querySignals = [
    ...(topic.keywords ?? []),
    ...(topic.search_queries ?? []),
    ...(topic.query_variants ?? []),
    ...(topic.required_keywords ?? []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const hasSeedUrls = (topic.seed_post_urls ?? []).some((value) => String(value || "").trim());
  const viralLike =
    title === "viral" ||
    title === "viral feed" ||
    intent === "viral" ||
    intent === "viral feed";
  if (!(viralLike && querySignals.length === 0 && !hasSeedUrls)) {
    return "top_score";
  }
  const hasDateFilter = Boolean(
    String(options.dateRange?.preset ?? "").trim() ||
      String(options.dateRange?.start_date ?? "").trim() ||
      String(options.dateRange?.end_date ?? "").trim(),
  );
  return hasDateFilter ? "score_then_day_spread" : "top_score";
}

export function effectiveTopicGateScore(
  topic: TopicFilter,
  requestedScore: number,
): number {
  const explicitScore = Number.isFinite(requestedScore)
    ? Math.max(0, requestedScore)
    : 0;
  const topicTitle = String(topic.topic_title ?? "").trim();
  const topicIntent = String(topic.topic_intent ?? "").trim();
  const querySignals = new Set(
    [
      ...topic.keywords,
      ...topic.search_queries,
      ...topic.query_variants,
      ...topic.required_keywords,
    ]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const normalizedTitle = topicTitle.toLowerCase();
  const isFeedOnlyTopic =
    normalizedTitle === "viral feed" || normalizedTitle === "viral";
  if (isFeedOnlyTopic && querySignals.size === 0 && !topicIntent) {
    return explicitScore;
  }

  let recommendedScore = 0;
  if (topicTitle && !isFeedOnlyTopic) recommendedScore = 0.07;
  if (topicIntent && !isFeedOnlyTopic) recommendedScore = Math.max(recommendedScore, 0.08);
  if (querySignals.size > 0) recommendedScore = Math.max(recommendedScore, 0.1);
  if (topic.required_keywords.length > 0) {
    recommendedScore = Math.max(
      recommendedScore,
      topic.required_keywords_mode === "all" ? 0.14 : 0.1,
    );
  }
  return Math.max(explicitScore, recommendedScore);
}

function seedUrlBypassesTopicGate(
  rawPost: RawPost,
  topicFilter: TopicFilter,
): boolean {
  const seedUrls = topicFilter.seed_post_urls || [];
  if (seedUrls.length === 0) return false;
  const postUrls = [
    String(rawPost.url ?? ""),
    String(rawPost.source_url ?? ""),
  ]
    .map((value) => (value.split("?")[0] || "").toLowerCase())
    .filter(Boolean);
  return seedUrls.some((seed) => {
    const seedUrl = (String(seed || "").split("?")[0] || "").toLowerCase();
    return postUrls.some((postUrl) => seedUrl && (postUrl.includes(seedUrl) || seedUrl.includes(postUrl)));
  });
}

function isDirectPostSeedTopic(topicFilter: TopicFilter): boolean {
  const seedUrls = topicFilter.seed_post_urls || [];
  return (
    seedUrls.length > 0 &&
    seedUrls.every((seed) => {
      try {
        const url = new URL(String(seed || "").trim());
        if (!/(^|\.)threads\.(?:com|net)$/i.test(url.hostname)) return false;
        return (
          /^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname) ||
          /^\/share\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname) ||
          /^\/t\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)
        );
      } catch {
        return false;
      }
    })
  );
}

function isStrictBlankViralTopic(
  topic: Pick<
    TopicFilter,
    | "keywords"
    | "query_variants"
    | "required_keywords"
    | "search_queries"
    | "seed_post_urls"
    | "topic_intent"
    | "topic_title"
  >,
): boolean {
  const querySignals = [
    ...(topic.keywords ?? []),
    ...(topic.search_queries ?? []),
    ...(topic.query_variants ?? []),
    ...(topic.required_keywords ?? []),
    ...(topic.seed_post_urls ?? []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (querySignals.length > 0) return false;

  const title = normalizeLooseLabel(topic.topic_title);
  const intent = normalizeLooseLabel(topic.topic_intent);
  return (
    (title === "" ||
      title === "viral" ||
      title === "viral feed" ||
      title === "trending" ||
      title === "hot" ||
      title === "top" ||
      title === "top threads" ||
      title === "xu huong") &&
    (intent === "" ||
      intent === "viral" ||
      intent === "viral feed" ||
      intent === "trending" ||
      intent === "hot" ||
      intent === "top" ||
      intent === "top threads" ||
      intent === "xu huong")
  );
}

function shouldEnforceImplicitViralSignalFloor(
  topicFilter: Pick<
    TopicFilter,
    | "keywords"
    | "query_variants"
    | "required_keywords"
    | "search_queries"
    | "seed_post_urls"
    | "topic_intent"
    | "topic_title"
  >,
  request: Pick<CrawlRequest, "ui_state">,
): boolean {
  if (isStrictBlankViralTopic(topicFilter)) {
    return request.ui_state?.advancedEnabled !== true;
  }

  return request.ui_state?.resume_requires_viral_signal_floor === true;
}

function meetsImplicitViralSignalFloor(
  post: RawPost,
  referenceTime?: string,
): boolean {
  const views = intValue(post.view_count);
  const likes = intValue(post.like_count);
  const replies = intValue(post.reply_count);
  const reposts = intValue(post.repost_count);
  const shares = intValue(post.share_count);
  const quoteCount = intValue(post.quote_count);
  const redistribution = reposts + shares + quoteCount;
  const engagementScore =
    likes + replies * 2 + reposts * 3 + shares * 2 + quoteCount * 3;
  const ageHours = postAgeHours(post.created_at, referenceTime);

  // Keep the entry gate aligned with the absolute ceiling used by viral score v2.
  // The final score gate still requires >=60, so these clauses only expand the
  // finalist pool; they do not lower the quality of returned posts.
  if (
    views >= 30_000 &&
    (likes >= 60 || replies >= 20 || redistribution >= 10)
  ) return true;
  if (likes >= 300 || engagementScore >= 700) return true;

  // Absolute proof prevents a weak post from looking viral merely because it is
  // the strongest item in a poor discovery batch.
  if (likes >= 500) return true;
  if (views >= 50_000 && likes >= 150) return true;
  if (redistribution >= 80 && (views >= 10_000 || likes >= 120)) return true;
  if (replies >= 120 && likes >= 120) return true;

  if (views >= 20_000 && likes >= 150 && (replies >= 20 || redistribution >= 10)) {
    return true;
  }
  if (views >= 12_000 && likes >= 220 && (replies >= 12 || redistribution >= 6)) {
    return true;
  }
  if (likes >= 300 && (views >= 5_000 || replies >= 30 || redistribution >= 15)) {
    return true;
  }

  // A fresh post can be viral before its absolute counters reach the mature
  // thresholds, but it still needs strong velocity across multiple metrics.
  if (ageHours <= 36) {
    if (views >= 8_000 && likes >= 120 && (replies >= 15 || redistribution >= 8)) {
      return true;
    }
    if (views >= 4_000 && likes >= 200 && (replies >= 20 || redistribution >= 10)) {
      return true;
    }
  }

  return false;
}

function postAgeHours(createdAt: unknown, referenceTime?: string): number {
  const created = new Date(String(createdAt ?? ""));
  const reference = new Date(String(referenceTime || ""));
  if (Number.isNaN(created.getTime())) return Number.POSITIVE_INFINITY;
  const referenceMs = Number.isNaN(reference.getTime()) ? Date.now() : reference.getTime();
  return Math.max(0, (referenceMs - created.getTime()) / 3_600_000);
}

function meetsImplicitViralContentQuality(post: RawPost): boolean {
  const text = normalizeForQuality(String(post.text ?? ""));
  if (!text) return false;
  if (isThreadsChromeOnlyText(text)) return false;

  const views = intValue(post.view_count);
  const likes = intValue(post.like_count);
  const replies = intValue(post.reply_count);
  const reposts = intValue(post.repost_count);
  const shares = intValue(post.share_count);
  const quoteCount = intValue(post.quote_count);
  const redistribution = reposts + shares + quoteCount;
  const strongViralProof =
    likes >= 1_000 ||
    redistribution >= 350 ||
    (views >= 80_000 && likes >= 500) ||
    (views >= 50_000 && replies >= 180 && likes >= 250);

  const lowValueScore = computeBlankViralLowValueScore(text);
  if (lowValueScore >= 0.75) return strongViralProof;
  if (lowValueScore >= 0.5 && !strongViralProof) return false;

  const wordCount = text.split(/\s+/u).filter(Boolean).length;
  const genericPrompt =
    containsQualityPhrase(text, "moi nguoi nghi sao") ||
    containsQualityPhrase(text, "goc thac mac") ||
    containsQualityPhrase(text, "co ai nhu minh") ||
    containsQualityPhrase(text, "cho minh hoi");
  if (
    genericPrompt &&
    wordCount <= 18 &&
    likes < 250 &&
    redistribution < 50 &&
    views < 30_000
  ) {
    return false;
  }

  return true;
}

function isThreadsChromeOnlyText(text: string): boolean {
  const withoutChrome = text
    .replace(/\bviral\b/gu, " ")
    .replace(/\btac gia\b/gu, " ")
    .replace(/\b\d+\s*(?:giay|phut|gio|ngay|tuan|thang|nam)\b/gu, " ")
    .replace(/\b(?:luc|hom qua|hom nay)\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutChrome) return true;
  const words = withoutChrome.split(/\s+/u).filter(Boolean);
  return words.length <= 2 && withoutChrome.length <= 12;
}

function computeBlankViralLowValueScore(text: string): number {
  const commerceSignals = [
    "shop",
    "khong co don",
    "khong co don duoc",
    "san pham",
    "scam",
    "don hang",
    "chot don",
    "khach hang",
    "tu van",
    "apply",
    "ung tuyen",
    "recruit",
    "tuyen dung",
    "can yeu cau",
    "kinh nghiem lam",
    "wedding planner",
    "mua o dau",
    "xin link",
    "zalo",
    "sdt",
  ];
  const adviceBaitSignals = [
    "rcm",
    "recommend",
    "xin review",
    "review giup",
    "xin y kien",
    "xin de xuat",
    "nho moi nguoi tu van",
    "moi nguoi cuu minh",
    "giup em voi",
    "giup minh voi",
  ];
  const nicheFandomSignals = [
    "idol",
    "fandom",
    "shipdom",
    "shipdom",
    "stan",
    "bias",
    "otp",
    "ot7",
    "heeseung",
    "enhypen",
    "toki",
    "sky moon",
    "rlp",
    "inter",
    "vhl",
    "hannah",
  ];

  let score = 0;
  for (const signal of commerceSignals) {
    if (containsQualityPhrase(text, signal)) score += 0.28;
  }
  for (const signal of adviceBaitSignals) {
    if (containsQualityPhrase(text, signal)) score += 0.2;
  }
  for (const signal of nicheFandomSignals) {
    if (containsQualityPhrase(text, signal)) score += 0.14;
  }
  if (text.includes("?")) score += 0.08;
  return Math.min(1, score);
}

function normalizeForQuality(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}?]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsQualityPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeForQuality(phrase);
  if (!normalizedPhrase) return false;
  return ` ${text} `.includes(` ${normalizedPhrase} `);
}

function buildComments(
  rawPost: RawPost,
  request: CrawlRequest,
): {
  comments: CommentData[];
  audit: Record<string, unknown>;
} {
  const comments: CommentData[] = [];
  const audit: Record<string, unknown> = {
    comments_seen: 0,
    comments_accepted: 0,
    comments_rejected: 0,
    comments_before_limit: 0,
    comments_limited_out: 0,
    comment_rejection_counts: {},
  };

  const originalRawComments = Array.isArray(rawPost.comments) ? rawPost.comments : [];
  const rawComments = dedupeRawComments(originalRawComments);
  if (rawComments.length < originalRawComments.length) {
    audit.duplicate_comment_candidates_collapsed =
      originalRawComments.length - rawComments.length;
  }
  const topLevelRawComments = rawComments.filter(
    (rawComment) => rawComment.is_reply !== true,
  );
  const nestedCommentsExcluded = rawComments.length - topLevelRawComments.length;
  if (nestedCommentsExcluded > 0) {
    audit.nested_comments_excluded = nestedCommentsExcluded;
  }
  const preserveSourceOrder =
    topLevelRawComments.length > 0 &&
    topLevelRawComments.every((rawComment) =>
      Number.isFinite(Number(rawComment.source_order)),
    );
  for (const rawComment of topLevelRawComments) {
    audit.comments_seen = intValue(audit.comments_seen) + 1;
    const sourceOrder = intValue(audit.comments_seen);
    const rejectionReason = commentFilterRejectionReason(
      rawComment,
      request.filters,
    );
    if (rejectionReason) {
      audit.comments_rejected = intValue(audit.comments_rejected) + 1;
      const counts = audit.comment_rejection_counts as Record<string, number>;
      counts[rejectionReason] = (counts[rejectionReason] ?? 0) + 1;
      continue;
    }

    comments.push(toCommentData(rawComment, sourceOrder));
  }

  const commentLimit = Math.max(0, request.filters.top_comments_per_post);
  const rankedComments = rankComments(comments, preserveSourceOrder);
  let accepted = rankedComments.slice(0, commentLimit);

  const scrubbedAvatars = scrubAmbiguousCommentAvatars(accepted);
  accepted = scrubbedAvatars.comments;
  if (scrubbedAvatars.blankCount > 0) {
    audit.suspect_duplicate_comment_avatars = scrubbedAvatars.blankCount;
  }

  audit.comment_ranking_basis = preserveSourceOrder
    ? "threads_top_level_source_order"
    : "like_count_then_reply_count";
  audit.comments_before_limit = comments.length;
  audit.comments_accepted = accepted.length;
  audit.comments_limited_out = Math.max(
    0,
    comments.length - accepted.length,
  );
  return { comments: accepted, audit };
}

function toCommentData(rawComment: RawComment, sourceOrder: number): CommentData {
  return {
    comment_id: String(rawComment.comment_id ?? ""),
    username: String(rawComment.username ?? ""),
    display_name: String(rawComment.display_name ?? ""),
    avatar_url: String(rawComment.avatar_url ?? ""),
    avatar_asset_path: String(rawComment.avatar_asset_path ?? ""),
    language: String(rawComment.language ?? ""),
    text: String(rawComment.text ?? ""),
    like_count: intValue(rawComment.like_count),
    reply_count: intValue(rawComment.reply_count),
    created_at: String(rawComment.created_at ?? ""),
    is_reply: Boolean(rawComment.is_reply),
    media: normalizeMedia(rawComment.media),
    source_order: Number.isFinite(Number(rawComment.source_order))
      ? Number(rawComment.source_order)
      : sourceOrder,
  };
}

export function buildOutputCommentsFromRawPost(
  rawPost: Pick<RawPost, "comments">,
  options: OutputCommentSelectionOptions = {},
): {
  comments: CommentData[];
  audit: Record<string, unknown>;
} {
  const request: CrawlRequest = {
    created_at: "",
    filters: {
      date_range: {
        end_date: "",
        preset: "",
        start_date: "",
      },
      exclude_commerce_content: false,
      exclude_posts_with_links: false,
      exclude_usernames: [],
      global_excluded_keywords: [],
      include_usernames: [],
      languages:
        Array.isArray(options.languages) && options.languages.length > 0
          ? options.languages.map((item) => String(item || "").trim()).filter(Boolean)
          : ["vi"],
      max_posts_per_topic: 0,
      max_text_length: 0,
      min_comment_likes: Math.max(0, Number(options.min_comment_likes ?? 0) || 0),
      min_comments: 0,
      min_loaded_top_comments: 0,
      min_post_likes: 0,
      min_post_views: 0,
      min_post_replies: 0,
      min_post_reposts: 0,
      min_post_score: 0,
      min_post_shares: 0,
      min_text_length: 0,
      min_topic_match_score: 0,
      ranking_mode: "weighted",
      ranking_weights: {
        comments: 16,
        likes: 14,
        recency: 8,
        reposts: 24,
        shares: 22,
        topic_match: 8,
        views: 8,
      },
      recency_half_life_hours: 168,
      require_comments: false,
      require_metrics: false,
      require_repost_or_share: false,
      sort_by: "score",
      source: "threads",
      text_contains_all: [],
      text_contains_any: [],
      text_excludes_any: [],
      top_comments_per_post: Math.max(0, Number(options.top_comments_per_post ?? 5) || 0),
      topics: [],
    },
    notes: "Auto-repair crawl comments from raw cache.",
    request_id: "__output_comment_repair__",
  };
  return buildComments(rawPost as RawPost, request);
}

function rankComments(
  comments: CommentData[],
  preserveSourceOrder = false,
): CommentData[] {
  return [...comments].sort(
    (a, b) =>
      (preserveSourceOrder ? a.source_order - b.source_order : b.like_count - a.like_count) ||
      (preserveSourceOrder ? b.like_count - a.like_count : b.reply_count - a.reply_count) ||
      a.source_order - b.source_order,
  );
}

function dedupeRawComments(rawComments: RawComment[]): RawComment[] {
  if (rawComments.length <= 1) return rawComments;

  const avatarOwners = buildAvatarOwnerMap(rawComments);
  const groups = new Map<
    string,
    Array<{ comment: RawComment; index: number }>
  >();

  rawComments.forEach((comment, index) => {
    const key = rawCommentDedupKey(comment, index);
    const group = groups.get(key);
    if (group) {
      group.push({ comment, index });
    } else {
      groups.set(key, [{ comment, index }]);
    }
  });

  const exactDeduped = [...groups.values()].map((group) =>
    chooseBestRawCommentCandidate(group, avatarOwners),
  );
  return collapseNearDuplicateRawComments(exactDeduped, avatarOwners);
}

function collapseNearDuplicateRawComments(
  comments: RawComment[],
  avatarOwners: Map<string, Set<string>>,
): RawComment[] {
  const output: Array<{ comment: RawComment; index: number }> = [];

  comments.forEach((comment, index) => {
    const duplicateIndex = output.findIndex((entry) =>
      areNearDuplicateRawComments(entry.comment, comment),
    );
    if (duplicateIndex < 0) {
      output.push({ comment, index });
      return;
    }

    const current = output[duplicateIndex];
    if (!current) return;
    const selected = chooseBestRawCommentCandidate(
      [current, { comment, index }],
      avatarOwners,
    );
    current.comment = selected;
  });

  return output.map((entry) => entry.comment);
}

function areNearDuplicateRawComments(a: RawComment, b: RawComment): boolean {
  const usernameA = String(a.username ?? "").trim().toLowerCase();
  const usernameB = String(b.username ?? "").trim().toLowerCase();
  if (!usernameA || usernameA !== usernameB) return false;
  if (Boolean(a.is_reply) !== Boolean(b.is_reply)) return false;

  const mediaA = rawCommentMediaKeys(a);
  const mediaB = rawCommentMediaKeys(b);
  if (mediaA.length === 0 || mediaB.length === 0) return false;
  if (!mediaA.some((key) => mediaB.includes(key))) return false;

  const textA = normalizeCommentSimilarityText(a);
  const textB = normalizeCommentSimilarityText(b);
  if (textA === textB || !textA || !textB) return true;

  const shorter = textA.length <= textB.length ? textA : textB;
  const longer = textA.length <= textB.length ? textB : textA;
  return (
    shorter.length >= 28 &&
    shorter.length / longer.length >= 0.35 &&
    longer.startsWith(shorter)
  );
}

function rawCommentMediaKeys(comment: RawComment): string[] {
  if (!Array.isArray(comment.media)) return [];
  return comment.media
    .filter(isRecord)
    .map((media) =>
      mediaAssetIdentityKey(
        String(media.remote_url ?? ""),
        String(media.asset_path ?? ""),
      ),
    )
    .filter(Boolean);
}

function normalizeCommentSimilarityText(comment: RawComment): string {
  return normalizeCommentDedupText(comment)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAvatarOwnerMap(rawComments: RawComment[]): Map<string, Set<string>> {
  const output = new Map<string, Set<string>>();
  for (const comment of rawComments) {
    const avatarKey = likelyUniqueProfileAvatarKey(String(comment.avatar_url ?? ""));
    const username = String(comment.username ?? "").trim().toLowerCase();
    if (!avatarKey || !username) continue;
    const owners = output.get(avatarKey) ?? new Set<string>();
    owners.add(username);
    output.set(avatarKey, owners);
  }
  return output;
}

function rawCommentDedupKey(comment: RawComment, index: number): string {
  const username = String(comment.username ?? "").trim().toLowerCase();
  const cleanedText = normalizeCommentDedupText(comment);
  if (!username || !cleanedText) {
    return `__raw_comment__${index}`;
  }
  return `${username}\n${cleanedText}`;
}

function normalizeCommentDedupText(comment: RawComment): string {
  return sanitizeCachedCommentText(
    comment.text,
    intValue(comment.like_count),
    intValue(comment.reply_count),
  )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function chooseBestRawCommentCandidate(
  group: Array<{ comment: RawComment; index: number }>,
  avatarOwners: Map<string, Set<string>>,
): RawComment {
  return [...group]
    .sort((a, b) => {
      const reliabilityDiff =
        rawCommentReliabilityScore(b.comment, avatarOwners) -
        rawCommentReliabilityScore(a.comment, avatarOwners);
      if (reliabilityDiff !== 0) return reliabilityDiff;

      const engagementDiff =
        intValue(b.comment.like_count) -
          intValue(a.comment.like_count) ||
        intValue(b.comment.reply_count) - intValue(a.comment.reply_count);
      if (engagementDiff !== 0) return engagementDiff;

      return a.index - b.index;
    })
    .map((entry) => entry.comment)[0] as RawComment;
}

function rawCommentReliabilityScore(
  comment: RawComment,
  avatarOwners: Map<string, Set<string>>,
): number {
  let score = 0;
  const cleanedText = normalizeCommentDedupText(comment);
  const rawText = String(comment.text ?? "").trim();
  const likeCount = intValue(comment.like_count);
  const replyCount = intValue(comment.reply_count);
  const trailingMetric = trailingStandaloneMetricCount(rawText);
  const avatarKey = likelyUniqueProfileAvatarKey(String(comment.avatar_url ?? ""));
  const avatarOwnerCount = avatarKey ? avatarOwners.get(avatarKey)?.size ?? 0 : 0;

  if (cleanedText.length >= 6) score += 20;
  if (avatarKey) {
    score += avatarOwnerCount <= 1 ? 90 : -160;
  }
  if (String(comment.avatar_asset_path ?? "").trim()) score += 8;

  if (trailingMetric > 0) {
    if (trailingMetric === likeCount && replyCount === 0) {
      score += 80;
    } else if (trailingMetric === likeCount) {
      score += 40;
    } else if (trailingMetric === replyCount && likeCount <= Math.max(2, trailingMetric * 2)) {
      score += 18;
    } else if (likeCount >= Math.max(20, trailingMetric * 5)) {
      score -= 180;
    } else if (replyCount >= Math.max(4, trailingMetric * 3)) {
      score -= 90;
    } else {
      score -= 50;
    }
  }

  if (rawText && cleanedText && rawText.toLowerCase() !== cleanedText) {
    score += 6;
  }

  return score;
}

function trailingStandaloneMetricCount(value: string): number {
  const match = String(value || "").trim().match(/(\d+(?:[.,]\d+)?\s*[KkMmBb]?)\s*$/);
  return match?.[1] ? intValue(parseMetricCountText(match[1])) : 0;
}

function parseMetricCountText(value: string): number {
  let text = String(value || "").trim().replace(/\s+/g, "");
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
  } else {
    text = text.replace(/,/g, "");
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? Math.floor(parsed * multiplier) : 0;
}

function scrubAmbiguousCommentAvatars(
  comments: CommentData[],
): { blankCount: number; comments: CommentData[] } {
  const seenProfileAvatarOwners = new Map<string, string>();
  let blankCount = 0;

  const output = comments.map((comment) => {
    const avatarKey = likelyUniqueProfileAvatarKey(comment.avatar_url);
    if (!avatarKey) return comment;

    const owner = seenProfileAvatarOwners.get(avatarKey);
    const username = String(comment.username || "").trim().toLowerCase();
    if (!owner) {
      seenProfileAvatarOwners.set(avatarKey, username);
      return comment;
    }
    if (!username || owner === username) {
      return comment;
    }

    blankCount += 1;
    return {
      ...comment,
      avatar_asset_path: "",
      avatar_url: "",
    };
  });

  return { blankCount, comments: output };
}

function likelyUniqueProfileAvatarKey(value: string): string {
  const lowered = String(value || "").trim().toLowerCase();
  if (!lowered) return "";
  if (lowered.includes("anonymous_profile_pic")) return "";
  if (
    lowered.includes("/t51.2885-19/") ||
    lowered.includes("/t51.82787-19/") ||
    lowered.includes("profile_pic")
  ) {
    return lowered;
  }
  return "";
}

function rejected(
  rawPost: RawPost,
  reason: string,
  options: {
    bypassTopicGate?: boolean;
    commentAudit?: Record<string, unknown>;
    filterAnalysis?: PostFilterAnalysis;
    match?: TopicMatch;
    score?: number;
    scoreBreakdown?: Record<string, number>;
  } = {},
): RejectedPostEvaluation {
  return {
    accepted: false,
    bypassTopicGate: options.bypassTopicGate ?? false,
    commentAudit:
      options.commentAudit ?? {
        comments_seen: 0,
        comments_accepted: 0,
        comments_rejected: 0,
        comments_before_limit: 0,
        comments_limited_out: 0,
        comment_rejection_counts: {},
      },
    filterAnalysis: options.filterAnalysis,
    match: options.match,
    rawPost,
    reason,
    score: options.score,
    scoreBreakdown: options.scoreBreakdown,
  };
}

function dateValue(value: string): number {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Number.NEGATIVE_INFINITY : date.getTime();
}

function spreadRankedPostsAcrossDays<
  TEntry extends {
    post: PostData;
  },
>(posts: TEntry[], limit: number): TEntry[] {
  const selected: TEntry[] = [];
  const usedIndexes = new Set<number>();
  const perDayCounts = new Map<string, number>();

  for (let maxPerDay = 1; selected.length < limit; maxPerDay += 1) {
    let addedThisPass = 0;
    for (let index = 0; index < posts.length && selected.length < limit; index += 1) {
      if (usedIndexes.has(index)) continue;
      const entry = posts[index];
      if (!entry) continue;
      const bucketKey = createdAtDayBucket(entry.post.created_at);
      if ((perDayCounts.get(bucketKey) ?? 0) >= maxPerDay) continue;
      usedIndexes.add(index);
      selected.push(entry);
      perDayCounts.set(bucketKey, (perDayCounts.get(bucketKey) ?? 0) + 1);
      addedThisPass += 1;
    }
    if (addedThisPass === 0) break;
  }

  if (selected.length >= limit) {
    return selected.slice(0, limit);
  }

  for (let index = 0; index < posts.length && selected.length < limit; index += 1) {
    if (usedIndexes.has(index)) continue;
    const entry = posts[index];
    if (!entry) continue;
    selected.push(entry);
  }
  return selected.slice(0, limit);
}

function spreadRankedPostsAcrossTimeWindows<
  TEntry extends {
    post: PostData;
  },
>(posts: TEntry[], limit: number, referenceTime?: string): TEntry[] {
  const preferredOrder = [
    "d17_30",
    "d10_16",
    "d05_09",
    "d02_04",
    "d00_01",
    "d31_60",
    "d61_120",
    "d121_plus",
    "unknown-date",
  ];
  const bucketCaps = new Map<string, number>([
    ["d00_01", 2],
    ["d02_04", 2],
    ["d05_09", 1],
    ["d10_16", 1],
    ["d17_30", 1],
    ["d31_60", 1],
    ["d61_120", 1],
    ["d121_plus", 1],
    ["unknown-date", 1],
  ]);
  const buckets = new Map<string, TEntry[]>();
  for (const entry of posts) {
    const bucketKey = createdAtTimeBucket(entry.post.created_at, referenceTime);
    const bucketEntries = buckets.get(bucketKey) ?? [];
    bucketEntries.push(entry);
    buckets.set(bucketKey, bucketEntries);
  }

  const selected: TEntry[] = [];
  const selectedCounts = new Map<string, number>();

  for (const bucketKey of preferredOrder) {
    if (selected.length >= limit) break;
    const bucketEntries = buckets.get(bucketKey) ?? [];
    const entry = bucketEntries.shift();
    if (!entry) continue;
    selected.push(entry);
    selectedCounts.set(bucketKey, 1);
    buckets.set(bucketKey, bucketEntries);
  }

  for (const bucketKey of preferredOrder) {
    while (selected.length < limit) {
      const bucketEntries = buckets.get(bucketKey) ?? [];
      const nextEntry = bucketEntries[0];
      if (!nextEntry) break;
      const cap = bucketCaps.get(bucketKey) ?? 1;
      const used = selectedCounts.get(bucketKey) ?? 0;
      if (used >= cap) break;
      bucketEntries.shift();
      selected.push(nextEntry);
      selectedCounts.set(bucketKey, used + 1);
      buckets.set(bucketKey, bucketEntries);
    }
  }

  if (selected.length >= limit) {
    return selected.slice(0, limit);
  }

  for (const entry of posts) {
    if (selected.length >= limit) break;
    if (selected.includes(entry)) continue;
    selected.push(entry);
  }

  if (selected.length > 0) {
    return selected.slice(0, limit);
  }
  return posts.slice(0, limit);
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

function createdAtTimeBucket(createdAt: string, referenceTime?: string): string {
  const created = parseDateTime(createdAt);
  const reference = parseDateTime(referenceTime) ?? new Date();
  if (!created) return "unknown-date";
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

function intValue(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLooseLabel(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseDateTime(value: string | undefined): Date | null {
  const date = new Date(String(value || "").trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeMedia(value: unknown): Array<{
  asset_path: string;
  height: number;
  order: number;
  remote_url: string;
  type: "image" | "video";
  width: number;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item, index) => {
      const type: "image" | "video" = item.type === "video" ? "video" : "image";
      return {
        asset_path: String(item.asset_path ?? ""),
        height: intValue(item.height),
        order: intValue(item.order) || index + 1,
        remote_url: String(item.remote_url ?? ""),
        type,
        width: intValue(item.width),
      };
    })
    .filter((item) => item.remote_url || item.asset_path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
