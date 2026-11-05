import type {
  CrawlRequest,
  PostData,
  RawPost,
  TopicFilter,
} from "../types.js";
import { buildPostMetricPeaks } from "../ranking/viral-score.js";
import {
  evaluateRawPostForOutput,
  resolveAcceptedPostSelectionStrategy,
  selectAcceptedPostResults,
} from "../selection/post-evaluation.js";
import { cacheKey } from "./threads-url.js";
import type { ThreadsWebCollectorConfig } from "./threads-web.js";

type MetricField =
  | "view_count"
  | "reply_count"
  | "repost_count"
  | "like_count"
  | "quote_count"
  | "share_count";

type DetailSelectionCandidate = {
  post: PostData;
  rawPost: RawPost;
  score: number;
  scoreBreakdown: Record<string, number>;
};

export function selectPostsForDetail(
  posts: RawPost[],
  config: ThreadsWebCollectorConfig,
  topic?: TopicFilter,
  request?: CrawlRequest,
): RawPost[] {
  const uniquePosts = uniqueRawPosts(posts);
  const targetOutputPosts = Math.max(1, Math.trunc(config.targetOutputPosts || 1));
  const feedOnlyMode = resolveDiscoveryStrategy(config) === "feed_only";
  const strictBlankViralMode = Boolean(request && topic && isStrictBlankViralTopic(topic));
  const detailReserveCount = feedOnlyMode
    ? targetOutputPosts <= 3
      ? targetOutputPosts + 4
      : Math.max(Math.ceil(targetOutputPosts * 1.6), targetOutputPosts + 8, 18)
    : targetOutputPosts <= 3
      ? targetOutputPosts + 2
      : Math.max(targetOutputPosts * 2, targetOutputPosts + 4);
  const boostedReserveCount = strictBlankViralMode
    ? Math.max(detailReserveCount, targetOutputPosts * 4, 16)
    : detailReserveCount;
  const reserveCount = Math.min(
    uniquePosts.length,
    config.maxDetailRequests > 0
      ? Math.max(targetOutputPosts, Math.trunc(config.maxDetailRequests))
      : boostedReserveCount,
  );

  if (strictBlankViralMode && request && topic) {
    const metricPeaks = buildPostMetricPeaks(uniquePosts, request.created_at);
    const qualityFilteredPosts = uniquePosts.filter((rawPost) =>
      evaluateRawPostForOutput(rawPost, topic, request, {
        metricPeaks,
        skipLoadedCommentGate: true,
        skipScoreGate: true,
      }).accepted,
    );
    const qualityKeys = new Set(
      qualityFilteredPosts.map((post) =>
        cacheKey(String(post.url || post.source_url || post.post_id || "")),
      ),
    );
    const rankedQuality = [...qualityFilteredPosts].sort(
      (a, b) =>
        discoveryViralScore(b, request.created_at) -
        discoveryViralScore(a, request.created_at),
    );
    const rankedFallback = uniquePosts
      .filter((post) =>
        !qualityKeys.has(
          cacheKey(String(post.url || post.source_url || post.post_id || "")),
        ),
      )
      .sort(
        (a, b) =>
          discoveryViralScore(b, request.created_at) -
          discoveryViralScore(a, request.created_at),
      );
    return takeDiverseRawPosts(
      [...rankedQuality, ...rankedFallback],
      reserveCount,
      2,
      { home_feed: Math.max(targetOutputPosts, Math.ceil(reserveCount * 0.4)) },
    );
  }

  if (request && topic) {
    const detailSelectionRequest = request;
    const metricPeaks = buildPostMetricPeaks(uniquePosts, request.created_at);
    const rankedPosts: DetailSelectionCandidate[] = uniquePosts
      .map((rawPost) => {
        const evaluated = evaluateRawPostForOutput(rawPost, topic, detailSelectionRequest, {
          metricPeaks,
          skipLoadedCommentGate: true,
          skipScoreGate: true,
        });
        if (!evaluated.accepted) return null;
        return {
          post: evaluated.post,
          rawPost,
          score: evaluated.score,
          scoreBreakdown: evaluated.scoreBreakdown,
        };
      })
      .filter(
        (candidate): candidate is DetailSelectionCandidate => Boolean(candidate),
      );
    return selectAcceptedPostResults(rankedPosts, {
      limit: reserveCount,
      referenceTime: detailSelectionRequest.created_at,
      sortBy: detailSelectionRequest.filters.sort_by,
      rankingMode: detailSelectionRequest.filters.ranking_mode,
      strategy: resolveAcceptedPostSelectionStrategy(topic, {
        dateRange: detailSelectionRequest.filters.date_range,
        sortBy: detailSelectionRequest.filters.sort_by,
      }),
    })
      .map((candidate) => candidate.rawPost);
  }

  const seedPosts = uniquePosts.filter(
    (post) => String(post.matched_query ?? "") === "seed_post_urls",
  );
  const remainingPosts = uniquePosts.filter(
    (post) => String(post.matched_query ?? "") !== "seed_post_urls",
  );
  sortRawPosts(remainingPosts, config.sortBy);

  const selected = [...seedPosts, ...remainingPosts].slice(0, reserveCount);
  return selected.length > 0 ? selected : uniquePosts.slice(0, reserveCount);
}

export function selectFinalPostsForOutput(
  posts: RawPost[],
  topic: TopicFilter,
  request: CrawlRequest,
  limit: number,
  options: {
    skipLoadedCommentGate?: boolean;
    skipScoreGate?: boolean;
    viralScoreFloorOverride?: number;
  } = {},
): RawPost[] {
  const uniquePosts = uniqueRawPosts(posts);
  const safeLimit = Math.max(1, Math.trunc(limit || 1));

  const metricPeaks = buildPostMetricPeaks(uniquePosts, request.created_at);
  const rankedPosts: DetailSelectionCandidate[] = uniquePosts
    .map((rawPost) => {
      const evaluated = evaluateRawPostForOutput(rawPost, topic, request, {
        metricPeaks,
        skipLoadedCommentGate: options.skipLoadedCommentGate,
        skipScoreGate: options.skipScoreGate,
        viralScoreFloorOverride: options.viralScoreFloorOverride,
      });
      if (!evaluated.accepted) return null;
      return {
        post: evaluated.post,
        rawPost,
        score: evaluated.score,
        scoreBreakdown: evaluated.scoreBreakdown,
      };
    })
    .filter((candidate): candidate is DetailSelectionCandidate => Boolean(candidate));

  const selected = selectAcceptedPostResults(rankedPosts, {
    limit: safeLimit,
    maxPostsPerAuthor: isStrictBlankViralTopic(topic) ? 1 : 0,
    maxPostsPerSource: isStrictBlankViralTopic(topic)
      ? { home_feed: Math.max(1, Math.floor(safeLimit * 0.4)) }
      : undefined,
    relaxSourceCaps: !isStrictBlankViralTopic(topic),
    referenceTime: request.created_at,
    sortBy: request.filters.sort_by,
    rankingMode: request.filters.ranking_mode,
    strategy: resolveAcceptedPostSelectionStrategy(topic, {
      dateRange: request.filters.date_range,
      sortBy: request.filters.sort_by,
    }),
  }).map((candidate) => candidate.rawPost);

  return selected;
}

function discoveryViralScore(post: RawPost, referenceTime?: string): number {
  const views = metricNumber(post.view_count);
  const likes = metricNumber(post.like_count);
  const replies = metricNumber(post.reply_count);
  const reposts = metricNumber(post.repost_count);
  const quotes = metricNumber(post.quote_count);
  const shares = metricNumber(post.share_count);
  const confidence = rawPostMetricConfidence(post);
  const ageHours = postAgeHours(post.created_at, referenceTime);
  const recencyFactor = Number.isFinite(ageHours)
    ? 0.45 + 0.55 * 2 ** (-ageHours / 720)
    : 0.45;
  return (
    views +
    likes * 55 +
    replies * 130 +
    (reposts + quotes + shares) * 210
  ) * Math.max(0.35, confidence) * recencyFactor;
}

function takeDiverseRawPosts(
  posts: RawPost[],
  limit: number,
  maxPostsPerAuthor: number,
  maxPostsPerSource: Record<string, number> = {},
): RawPost[] {
  const selected: RawPost[] = [];
  const selectedKeys = new Set<string>();
  const authorCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const tryAdd = (
    post: RawPost,
    constraints: { enforceAuthor: boolean; enforceSource: boolean },
  ): void => {
    if (selected.length >= limit) return;
    const key = cacheKey(String(post.url || post.source_url || post.post_id || ""));
    if (!key || selectedKeys.has(key)) return;
    const author = normalizeLooseLabel(String(post.username ?? "")) || `post:${key}`;
    const source = String(post.discovery_source || "unknown").trim().toLowerCase() || "unknown";
    const authorCount = authorCounts.get(author) ?? 0;
    const sourceCount = sourceCounts.get(source) ?? 0;
    const sourceCap = maxPostsPerSource[source];
    if (constraints.enforceAuthor && authorCount >= maxPostsPerAuthor) return;
    if (
      constraints.enforceSource &&
      sourceCap !== undefined &&
      sourceCount >= sourceCap
    ) return;
    authorCounts.set(author, authorCount + 1);
    sourceCounts.set(source, sourceCount + 1);
    selectedKeys.add(key);
    selected.push(post);
  };

  for (const post of posts) {
    tryAdd(post, { enforceAuthor: true, enforceSource: true });
  }
  for (const post of posts) {
    tryAdd(post, { enforceAuthor: true, enforceSource: false });
  }
  for (const post of posts) {
    tryAdd(post, { enforceAuthor: false, enforceSource: false });
  }

  const homeFeedCap = Math.max(
    0,
    Math.trunc(maxPostsPerSource.home_feed ?? 0),
  );
  return homeFeedCap > 0
    ? interleaveCappedRawPostSource(selected, "home_feed", homeFeedCap, limit)
    : selected;
}

function interleaveCappedRawPostSource(
  posts: RawPost[],
  constrainedSource: string,
  sourceCap: number,
  plannedLimit: number,
): RawPost[] {
  const constrained = posts.filter(
    (post) => String(post.discovery_source || "").trim().toLowerCase() === constrainedSource,
  );
  const alternatives = posts.filter(
    (post) => String(post.discovery_source || "").trim().toLowerCase() !== constrainedSource,
  );
  if (constrained.length === 0 || alternatives.length === 0) return posts;

  const output: RawPost[] = [];
  let constrainedIndex = 0;
  let alternativeIndex = 0;
  const safeLimit = Math.max(1, plannedLimit);
  while (output.length < posts.length) {
    const allowedConstrained = Math.min(
      sourceCap,
      Math.floor(((output.length + 1) * sourceCap) / safeLimit),
    );
    const canTakeConstrained = constrainedIndex < constrained.length;
    const shouldTakeConstrained =
      canTakeConstrained &&
      (constrainedIndex < allowedConstrained || alternativeIndex >= alternatives.length);
    if (shouldTakeConstrained) {
      output.push(constrained[constrainedIndex++]!);
    } else if (alternativeIndex < alternatives.length) {
      output.push(alternatives[alternativeIndex++]!);
    } else if (canTakeConstrained) {
      output.push(constrained[constrainedIndex++]!);
    } else {
      break;
    }
  }
  return output;
}

function postAgeHours(createdAt: unknown, referenceTime?: string): number {
  const created = new Date(String(createdAt ?? ""));
  const reference = new Date(String(referenceTime ?? ""));
  if (Number.isNaN(created.getTime())) return Number.POSITIVE_INFINITY;
  const referenceMs = Number.isNaN(reference.getTime()) ? Date.now() : reference.getTime();
  return Math.max(0, (referenceMs - created.getTime()) / 3_600_000);
}

export function uniqueRawPosts(posts: RawPost[]): RawPost[] {
  const seen = new Set<string>();
  const output: RawPost[] = [];
  for (const post of posts) {
    const key = cacheKey(String(post.url || post.source_url || post.post_id || ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(post);
  }
  return output;
}

export function dedupeUrlList(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

export function resolveDiscoveryStrategy(
  config: ThreadsWebCollectorConfig,
): "feed_only" | "topic_search" {
  return config.includeHomeFeed && config.maxSearchQueriesPerTopic === 0
    ? "feed_only"
    : "topic_search";
}

export function isStrictBlankViralTopic(topic: Pick<
  TopicFilter,
  "keywords" | "query_variants" | "required_keywords" | "search_queries" | "seed_post_urls" | "topic_intent" | "topic_title"
>): boolean {
  const hasSignals =
    topic.search_queries.some((value) => String(value || "").trim()) ||
    topic.query_variants.some((value) => String(value || "").trim()) ||
    topic.required_keywords.some((value) => String(value || "").trim()) ||
    topic.keywords.some((value) => String(value || "").trim()) ||
    topic.seed_post_urls.some((value) => String(value || "").trim());
  if (hasSignals) return false;

  const title = normalizeLooseLabel(topic.topic_title);
  const intent = normalizeLooseLabel(topic.topic_intent);
  return (
    (title === "" || title === "viral" || title === "viral feed" || title === "trending" || title === "hot" || title === "top" || title === "top threads" || title === "xu huong") &&
    (intent === "" || intent === "viral" || intent === "viral feed" || intent === "trending" || intent === "hot" || intent === "top" || intent === "top threads" || intent === "xu huong")
  );
}

function normalizeLooseLabel(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sortRawPosts(posts: RawPost[], sortBy: string): void {
  const key = (sortBy || "views").trim().toLowerCase();
  if (["newest", "latest", "created_at", "date"].includes(key)) {
    posts.sort((a, b) => dateSortValue(b.created_at) - dateSortValue(a.created_at));
    return;
  }
  if (["likes", "like_count"].includes(key)) {
    posts.sort(
      (a, b) =>
        weightedMetricSortValue(b, "like_count") -
        weightedMetricSortValue(a, "like_count"),
    );
    return;
  }
  if (["comments", "replies", "reply_count"].includes(key)) {
    posts.sort(
      (a, b) =>
        weightedMetricSortValue(b, "reply_count") -
        weightedMetricSortValue(a, "reply_count"),
    );
    return;
  }
  if (["reposts", "repost_count"].includes(key)) {
    posts.sort(
      (a, b) =>
        weightedMetricSortValue(b, "repost_count") -
        weightedMetricSortValue(a, "repost_count"),
    );
    return;
  }
  if (["shares", "share_count"].includes(key)) {
    posts.sort(
      (a, b) =>
        weightedMetricSortValue(b, "share_count") -
        weightedMetricSortValue(a, "share_count"),
    );
    return;
  }
  posts.sort(
    (a, b) =>
      weightedMetricSortValue(b, "view_count") -
      weightedMetricSortValue(a, "view_count"),
  );
}

function dateSortValue(value: unknown): number {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function weightedMetricSortValue(post: RawPost, field: MetricField): number {
  const value = metricNumber(post[field]);
  const confidence = rawPostMetricConfidence(post);
  return value * Math.max(0.35, confidence);
}

function rawPostMetricConfidence(post: RawPost): number {
  const snapshot = isRecord(post.metrics_snapshot) ? post.metrics_snapshot : {};
  const value = Number(snapshot.metric_confidence);
  if (Number.isFinite(value) && value > 0) return Math.max(0, Math.min(1, value));
  const source = String(snapshot.source ?? "").trim().toLowerCase();
  if (source === "activity_modal") return 0.98;
  if (source === "labeled_dom") return 0.85;
  if (source === "positional_text") return 0.55;
  return 0.4;
}

function metricNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
