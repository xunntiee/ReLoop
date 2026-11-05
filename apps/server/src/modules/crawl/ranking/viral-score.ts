import type { RankingMode, RankingWeights, RawComment, RawPost } from "../types.js";

interface WeightedPostComponents {
  engagement_score: number;
  like_score: number;
  reply_score: number;
  repost_score: number;
  share_score: number;
}

export interface PostMetricPeaks {
  comments: number;
  cohorts?: Record<string, ViralFeatureCohort>;
  likes: number;
  reference_time?: string;
  reposts: number;
  shares: number;
  views: number;
}

interface ViralFeatureCohort {
  conversation: number[];
  engagement: number[];
  reach: number[];
  spread: number[];
  velocity: number[];
}

export function computeEngagementScore(post: RawPost): number {
  return weightedPostComponents({
    like_count: numberValue(post.like_count),
    reply_count: numberValue(post.reply_count),
    repost_count: numberValue(post.repost_count),
    share_count: numberValue(post.share_count),
  }).engagement_score;
}

export function buildPostMetricPeaks(
  posts: RawPost[],
  referenceTime?: string,
): PostMetricPeaks {
  const resolvedReferenceTime = parseDateTime(referenceTime)?.toISOString() ?? new Date().toISOString();
  const cohorts: Record<string, ViralFeatureCohort> = {};
  for (const post of posts) {
    const features = computeViralFeatureValues(post, resolvedReferenceTime);
    const bucket = ageBucket(post.created_at, resolvedReferenceTime);
    const cohort = cohorts[bucket] ?? emptyViralFeatureCohort();
    cohort.conversation.push(features.conversation);
    cohort.engagement.push(features.engagement);
    cohort.reach.push(features.reach);
    cohort.spread.push(features.spread);
    cohort.velocity.push(features.velocity);
    cohorts[bucket] = cohort;
  }
  for (const cohort of Object.values(cohorts)) {
    cohort.conversation.sort(numericAscending);
    cohort.engagement.sort(numericAscending);
    cohort.reach.sort(numericAscending);
    cohort.spread.sort(numericAscending);
    cohort.velocity.sort(numericAscending);
  }
  return {
    comments: robustPeak(posts.map((post) => numberValue(post.reply_count))),
    cohorts,
    likes: robustPeak(posts.map((post) => numberValue(post.like_count))),
    reference_time: resolvedReferenceTime,
    reposts: robustPeak(posts.map((post) => numberValue(post.repost_count))),
    shares: robustPeak(posts.map((post) => numberValue(post.share_count))),
    views: robustPeak(posts.map((post) => numberValue(post.view_count))),
  };
}

export function computePostScoreBreakdown(
  post: RawPost,
  options: {
    matchScore: number;
    metricPeaks?: PostMetricPeaks;
    rankingMode: RankingMode;
    rankingWeights: RankingWeights;
    referenceTime?: string;
    recencyHalfLifeHours?: number;
    sortBy?: string;
  },
): Record<string, number> {
  const components = weightedPostComponents({
    like_count: numberValue(post.like_count),
    reply_count: numberValue(post.reply_count),
    repost_count: numberValue(post.repost_count),
    share_count: numberValue(post.share_count),
  });
  const engagementScore = components.engagement_score;
  const recencySignal = computeRecencyMultiplier(post.created_at, {
    referenceTime: options.referenceTime,
    halfLifeHours: options.recencyHalfLifeHours ?? 168,
  });
  const topicMatchSignal = clamp(options.matchScore, 0, 1);
  const metricPeaks =
    options.metricPeaks ?? buildPostMetricPeaks([post], options.referenceTime);

  const metricReliability = computeMetricReliability(post);
  const viewsSignal = normalizeMetric(numberValue(post.view_count), metricPeaks.views);
  const likesSignal = normalizeMetric(numberValue(post.like_count), metricPeaks.likes);
  const commentsSignal =
    normalizeMetric(numberValue(post.reply_count), metricPeaks.comments) *
    metricReliability.comments;
  const repostsSignal =
    normalizeMetric(numberValue(post.repost_count), metricPeaks.reposts) *
    metricReliability.reposts;
  const sharesSignal =
    normalizeMetric(numberValue(post.share_count), metricPeaks.shares) *
    metricReliability.shares;

  if (options.rankingMode === "weighted") {
    return computeWeightedBreakdown(
      {
        commentsSignal,
        likesSignal,
        metricReliability,
        recencySignal,
        repostsSignal,
        sharesSignal,
        topicMatchSignal,
        viewsSignal,
      },
      options.rankingWeights,
      post,
      metricPeaks,
      options.referenceTime,
    );
  }

  const relevanceMultiplier = 0.7 + topicMatchSignal * 0.6;
  const fallbackRelevanceScore = engagementScore <= 0 ? 50 * topicMatchSignal : 0;
  const rankingBaseScore = engagementScore + fallbackRelevanceScore;
  const finalScore = rankingBaseScore * recencySignal * relevanceMultiplier;

  return {
    comments_score: round(commentsSignal * 100, 3),
    comments_signal: round(commentsSignal, 3),
    engagement_score: round(engagementScore, 3),
    fallback_relevance_score: round(fallbackRelevanceScore, 3),
    final_score: round(finalScore, 3),
    like_score: round(components.like_score, 3),
    likes_score: round(likesSignal * 100, 3),
    likes_signal: round(likesSignal, 3),
    metric_confidence: computeMetricConfidence(post),
    metric_reliability_comments: round(metricReliability.comments, 3),
    metric_reliability_reposts: round(metricReliability.reposts, 3),
    metric_reliability_shares: round(metricReliability.shares, 3),
    ranking_base_score: round(rankingBaseScore, 3),
    recency_multiplier: round(recencySignal, 3),
    recency_score: round(recencySignal * 100, 3),
    recency_signal: round(recencySignal, 3),
    relevance_multiplier: round(relevanceMultiplier, 3),
    reply_score: round(components.reply_score, 3),
    repost_score: round(components.repost_score, 3),
    reposts_score: round(repostsSignal * 100, 3),
    reposts_signal: round(repostsSignal, 3),
    share_score: round(components.share_score, 3),
    shares_score: round(sharesSignal * 100, 3),
    shares_signal: round(sharesSignal, 3),
    topic_match_score: round(topicMatchSignal * 100, 3),
    topic_match_signal: round(topicMatchSignal, 3),
    views_score: round(viewsSignal * 100, 3),
    views_signal: round(viewsSignal, 3),
  };
}

export function computeCommentScoreBreakdown(comment: RawComment): Record<string, unknown> {
  const likeCount = numberValue(comment.like_count);
  const replyCount = numberValue(comment.reply_count);
  const text = String(comment.text ?? "");
  const engagementScore = likeCount + replyCount * 2;
  const metricsAvailable = engagementScore > 0;
  const textTiebreaker = metricsAvailable ? Math.min(5, Math.max(0, text.trim().length / 80)) : 0;
  const finalScore = engagementScore + textTiebreaker;

  return {
    like_score: likeCount,
    reply_score: replyCount * 2,
    engagement_score: round(engagementScore, 3),
    text_tiebreaker: round(textTiebreaker, 3),
    metrics_available: metricsAvailable,
    rank_basis: metricsAvailable ? "comment_engagement" : "source_order_no_comment_metrics",
    final_score: round(finalScore, 3),
  };
}

export function computeMetricConfidence(post: RawPost): number {
  const snapshot = isRecord(post.metrics_snapshot) ? post.metrics_snapshot : {};
  const validated = Number(snapshot.metric_confidence);
  if (Number.isFinite(validated) && validated > 0) {
    return clamp(validated, 0, 1);
  }
  const source = String(snapshot.source ?? "").trim();
  if (source === "labeled_dom") return 1;
  if (source === "positional_text") return 0.85;
  if (source) return 0.7;
  return 0;
}

export function computeRecencyMultiplier(
  createdAt: unknown,
  options: { referenceTime?: string; halfLifeHours?: number } = {},
): number {
  const created = parseDateTime(createdAt);
  const reference = parseDateTime(options.referenceTime) ?? new Date();
  const halfLifeHours = options.halfLifeHours ?? 168;
  if (!created || halfLifeHours <= 0) return 1;
  const ageHours = Math.max(0, (reference.getTime() - created.getTime()) / 3_600_000);
  return clamp(0.5 ** (ageHours / halfLifeHours), 0.05, 1);
}

function computeWeightedBreakdown(
  signals: {
    commentsSignal: number;
    likesSignal: number;
    metricReliability: MetricReliability;
    recencySignal: number;
    repostsSignal: number;
    sharesSignal: number;
    topicMatchSignal: number;
    viewsSignal: number;
  },
  weights: RankingWeights,
  post: RawPost,
  metricPeaks: PostMetricPeaks,
  referenceTime?: string,
): Record<string, number> {
  const safeWeights = normalizeWeights(weights);
  const totalWeight =
    safeWeights.views +
    safeWeights.likes +
    safeWeights.comments +
    safeWeights.reposts +
    safeWeights.shares +
    safeWeights.topic_match +
    safeWeights.recency;

  const weightedViews = weightedContribution(signals.viewsSignal, safeWeights.views, totalWeight);
  const weightedLikes = weightedContribution(signals.likesSignal, safeWeights.likes, totalWeight);
  const weightedComments = weightedContribution(signals.commentsSignal, safeWeights.comments, totalWeight);
  const weightedReposts = weightedContribution(signals.repostsSignal, safeWeights.reposts, totalWeight);
  const weightedShares = weightedContribution(signals.sharesSignal, safeWeights.shares, totalWeight);
  const weightedTopicMatch = weightedContribution(signals.topicMatchSignal, safeWeights.topic_match, totalWeight);
  const weightedRecency = weightedContribution(signals.recencySignal, safeWeights.recency, totalWeight);
  const resolvedReferenceTime =
    parseDateTime(referenceTime)?.toISOString() ??
    metricPeaks.reference_time ??
    new Date().toISOString();
  const featureValues = computeViralFeatureValues(post, resolvedReferenceTime);
  const cohort = metricPeaks.cohorts?.[ageBucket(post.created_at, resolvedReferenceTime)];
  const reachSignal = calibratedFeatureSignal(featureValues.reach, 2_500, 1_000_000, cohort?.reach);
  const velocitySignal = calibratedFeatureSignal(featureValues.velocity, 120, 25_000, cohort?.velocity);
  const spreadSignal = calibratedFeatureSignal(featureValues.spread, 0.4, 30, cohort?.spread);
  const engagementRateSignal = calibratedFeatureSignal(featureValues.engagement, 3, 100, cohort?.engagement);
  const conversationSignal = calibratedFeatureSignal(featureValues.conversation, 0.3, 15, cohort?.conversation);
  const freshnessSignal = computeRecencyMultiplier(post.created_at, {
    referenceTime: resolvedReferenceTime,
    halfLifeHours: 168,
  });
  const confidence = effectiveMetricConfidence(post);
  const viralRatioSignal = computeViralityRatioSignal(post, signals.metricReliability);
  const redistributionSignal = computeRedistributionSignal(post, signals);
  const lowValuePenaltySignal = computeLowValueContentPenaltySignal(post);
  const absoluteViralCeiling = computeAbsoluteViralityCeiling(post);
  const rawFinalScore = 100 * (
    reachSignal * 0.3 +
    velocitySignal * 0.25 +
    spreadSignal * 0.2 +
    engagementRateSignal * 0.15 +
    conversationSignal * 0.05 +
    freshnessSignal * 0.05
  );
  const calibratedScore = calibrateViralScore(rawFinalScore);
  const confidenceAdjustedScore = calibratedScore * (0.8 + confidence * 0.2);
  const qualityBoost = 0;
  const lowValuePenalty = 0;
  const finalScore = clamp(Math.min(confidenceAdjustedScore, absoluteViralCeiling), 0, 100);

  return {
    absolute_viral_ceiling: round(absoluteViralCeiling, 3),
    comments_score: round(weightedComments, 3),
    comments_signal: round(signals.commentsSignal, 3),
    calibrated_score: round(calibratedScore, 3),
    content_penalty_score: round(lowValuePenalty, 3),
    content_penalty_signal: round(lowValuePenaltySignal, 3),
    content_quality_score: round((1 - lowValuePenaltySignal) * 100, 3),
    conversation_score: round(conversationSignal * 100, 3),
    conversation_value: round(featureValues.conversation, 3),
    engagement_score: round(computeEngagementScore(post), 3),
    final_score: round(finalScore, 3),
    freshness_score: round(freshnessSignal * 100, 3),
    engagement_rate_score: round(engagementRateSignal * 100, 3),
    engagement_rate_value: round(featureValues.engagement, 3),
    estimated_views_used:
      numberValue(post.view_count) > 0 ? 0 : round(featureValues.reach, 3),
    likes_score: round(weightedLikes, 3),
    likes_signal: round(signals.likesSignal, 3),
    metric_confidence: computeMetricConfidence(post),
    metric_reliability_comments: round(signals.metricReliability.comments, 3),
    metric_reliability_reposts: round(signals.metricReliability.reposts, 3),
    metric_reliability_shares: round(signals.metricReliability.shares, 3),
    quality_boost_score: round(qualityBoost, 3),
    raw_final_score: round(rawFinalScore, 3),
    confidence_adjusted_score: round(confidenceAdjustedScore, 3),
    recency_score: round(weightedRecency, 3),
    recency_signal: round(signals.recencySignal, 3),
    redistribution_signal: round(redistributionSignal, 3),
    reach_score: round(reachSignal * 100, 3),
    reach_value: round(featureValues.reach, 3),
    reposts_score: round(weightedReposts, 3),
    reposts_signal: round(signals.repostsSignal, 3),
    shares_score: round(weightedShares, 3),
    shares_signal: round(signals.sharesSignal, 3),
    spread_score: round(spreadSignal * 100, 3),
    spread_value: round(featureValues.spread, 3),
    topic_match_score: round(weightedTopicMatch, 3),
    topic_match_signal: round(signals.topicMatchSignal, 3),
    views_score: round(weightedViews, 3),
    views_signal: round(signals.viewsSignal, 3),
    velocity_score: round(velocitySignal * 100, 3),
    velocity_value: round(featureValues.velocity, 3),
    virality_ratio_signal: round(viralRatioSignal, 3),
    weight_comments: round(safeWeights.comments, 3),
    weight_likes: round(safeWeights.likes, 3),
    weight_recency: round(safeWeights.recency, 3),
    weight_reposts: round(safeWeights.reposts, 3),
    weight_shares: round(safeWeights.shares, 3),
    weight_topic_match: round(safeWeights.topic_match, 3),
    weight_views: round(safeWeights.views, 3),
    viral_score_version: 3,
  };
}

interface MetricReliability {
  comments: number;
  reposts: number;
  shares: number;
}

function computeMetricReliability(post: RawPost): MetricReliability {
  const likes = numberValue(post.like_count);
  const replies = numberValue(post.reply_count);
  const reposts = numberValue(post.repost_count);
  const shares = numberValue(post.share_count);
  const reliability: MetricReliability = {
    comments: 1,
    reposts: 1,
    shares: 1,
  };

  // Threads DOM occasionally leaks the same visible count into adjacent metric slots.
  // If replies and reposts are identical, treat reposts as weak until parser evidence improves.
  if (replies >= 8 && reposts === replies) {
    reliability.reposts = 0.25;
    reliability.comments = 0.85;
  }
  if (replies >= 8 && shares === replies) {
    reliability.shares = 0.35;
    reliability.comments = Math.min(reliability.comments, 0.9);
  }
  if (likes <= 5 && reposts + shares >= 20 && numberValue(post.view_count) < 10_000) {
    reliability.reposts = Math.min(reliability.reposts, 0.35);
    reliability.shares = Math.min(reliability.shares, 0.35);
    if (replies >= 15) {
      reliability.comments = Math.min(reliability.comments, 0.85);
    }
  }

  return reliability;
}

function computeAbsoluteViralityCeiling(post: RawPost): number {
  const views = numberValue(post.view_count);
  const likes = numberValue(post.like_count);
  const replies = numberValue(post.reply_count);
  const reposts = numberValue(post.repost_count);
  const shares = numberValue(post.share_count);
  const quotes = numberValue(post.quote_count);
  const redistribution = reposts + shares + quotes;
  const engagementScore = computeEngagementScore(post);

  if (views >= 30_000 && (likes >= 60 || replies >= 20 || redistribution >= 10)) return 100;
  if (likes >= 300 || engagementScore >= 700) return 100;

  let ceiling = 48;
  if (views >= 2_500) ceiling = Math.max(ceiling, 58);
  if (views >= 5_000) ceiling = Math.max(ceiling, 68);
  if (views >= 10_000) ceiling = Math.max(ceiling, 78);
  if (views >= 18_000) ceiling = Math.max(ceiling, 88);

  if (likes >= 20) ceiling = Math.max(ceiling, 65);
  if (likes >= 50) ceiling = Math.max(ceiling, 78);
  if (likes >= 100) ceiling = Math.max(ceiling, 88);
  if (likes >= 180) ceiling = Math.max(ceiling, 96);

  if (replies >= 40 && (likes >= 20 || views >= 5_000)) ceiling = Math.max(ceiling, 75);
  if (replies >= 80 && (likes >= 20 || views >= 5_000)) ceiling = Math.max(ceiling, 86);

  if (redistribution >= 20 && (likes >= 20 || views >= 5_000)) ceiling = Math.max(ceiling, 78);
  if (redistribution >= 40 && (likes >= 40 || views >= 8_000)) ceiling = Math.max(ceiling, 88);

  if (likes < 10 && views < 5_000) ceiling = Math.min(ceiling, 58);
  if (likes < 5 && views < 5_000) ceiling = Math.min(ceiling, 52);
  return clamp(ceiling, 0, 100);
}

function computeViralityRatioSignal(post: RawPost, reliability: MetricReliability): number {
  const views = resolveScoringViewCount(post);
  if (views < 500) return 0;

  const likes = numberValue(post.like_count);
  const replies = numberValue(post.reply_count) * reliability.comments;
  const reposts = numberValue(post.repost_count) * reliability.reposts;
  const shares = numberValue(post.share_count) * reliability.shares;
  const quotes = numberValue(post.quote_count);
  const weightedInteractions =
    likes * 0.35 +
    replies * 0.9 +
    reposts * 1.8 +
    shares * 2.0 +
    quotes * 1.8;
  const interactionsPerThousandViews = (weightedInteractions / Math.max(views, 1)) * 1000;
  return clamp(interactionsPerThousandViews / 35, 0, 1);
}

function computeRedistributionSignal(
  post: RawPost,
  signals: {
    repostsSignal: number;
    sharesSignal: number;
  },
): number {
  const quotes = numberValue(post.quote_count);
  const quoteSignal = quotes > 0 ? normalizeMetric(quotes, Math.max(10, quotes)) : 0;
  return clamp(
    signals.repostsSignal * 0.45 +
      signals.sharesSignal * 0.45 +
      quoteSignal * 0.1,
    0,
    1,
  );
}

function computeLowValueContentPenaltySignal(post: RawPost): number {
  const text = normalizeForSignal(String(post.text ?? ""));
  if (!text) return 0;

  const strongSignals = [
    "rcm",
    "recommend",
    "de xuat",
    "xin de xuat",
    "cho minh hoi",
    "xin y kien",
    "minh dang tim",
    "t dang tim",
    "tim shop",
    "mua o dau",
    "xin review",
    "review giup",
    "co nen",
    "o dau ngon",
    "quan nao",
    "co quan",
    "target",
    "shop hoa",
    "zalo",
    "shopee",
    "freeship",
    "free ship",
    "voucher",
    "link bio",
    "xin link",
  ];
  const weakSignals = [
    "mn oi",
    "mng oi",
    "moi nguoi oi",
    "ai biet",
    "co ai",
    "giup em",
    "giup minh",
    "nen tang gi",
    "nen mua gi",
  ];

  let score = 0;
  for (const signal of strongSignals) {
    if (containsNormalizedPhrase(text, signal)) score += 0.28;
  }
  for (const signal of weakSignals) {
    if (containsNormalizedPhrase(text, signal)) score += 0.12;
  }
  if (/\?$/.test(text) || text.includes("?")) score += 0.08;
  return clamp(score, 0, 1);
}

function normalizeForSignal(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}?]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeForSignal(phrase);
  if (!normalizedPhrase) return false;
  return ` ${text} `.includes(` ${normalizedPhrase} `);
}

function resolveScoringViewCount(post: RawPost): number {
  const reportedViews = Math.max(0, numberValue(post.view_count));
  if (reportedViews > 0) return reportedViews;

  const reliability = computeMetricReliability(post);
  const likes = Math.max(0, numberValue(post.like_count));
  const replies = Math.max(0, numberValue(post.reply_count)) * reliability.comments;
  const reposts = Math.max(0, numberValue(post.repost_count)) * reliability.reposts;
  const shares = Math.max(0, numberValue(post.share_count)) * reliability.shares;
  const quotes = Math.max(0, numberValue(post.quote_count));
  const engagement = likes + replies * 2 + reposts * 3 + shares * 2 + quotes * 3;

  // Threads does not expose view_count for every post. Use a conservative
  // internal reach floor so missing data is not scored as zero reach.
  return Math.round(
    Math.max(
      likes * 12,
      replies * 35,
      reposts * 45,
      shares * 50,
      quotes * 45,
      engagement * 5,
    ),
  );
}
function computeViralFeatureValues(
  post: RawPost,
  referenceTime: string,
): {
  conversation: number;
  engagement: number;
  reach: number;
  spread: number;
  velocity: number;
} {
  const views = resolveScoringViewCount(post);
  const likes = Math.max(0, numberValue(post.like_count));
  const replies = Math.max(0, numberValue(post.reply_count));
  const reposts = Math.max(0, numberValue(post.repost_count));
  const shares = Math.max(0, numberValue(post.share_count));
  const quotes = Math.max(0, numberValue(post.quote_count));
  const reliability = computeMetricReliability(post);
  const reliableReplies = replies * reliability.comments;
  const reliableReposts = reposts * reliability.reposts;
  const reliableShares = shares * reliability.shares;
  const smoothedViews = views + 5_000;
  const ageHours = Math.max(0, postAgeHours(post.created_at, referenceTime));

  return {
    conversation: (reliableReplies / smoothedViews) * 1_000,
    engagement:
      ((likes + reliableReplies * 2 + reliableReposts * 3 + reliableShares * 2 + quotes * 3) /
        smoothedViews) *
      1_000,
    reach: views,
    spread:
      ((reliableShares * 2 + reliableReposts * 1.8 + quotes * 1.8) / smoothedViews) *
      1_000,
    velocity: views / Math.max(1, (ageHours + 6) ** 0.75),
  };
}

function calibratedFeatureSignal(
  value: number,
  lowerAnchor: number,
  upperAnchor: number,
  cohort?: number[],
): number {
  const absoluteSignal = logRangeSignal(value, lowerAnchor, upperAnchor);
  if (!cohort || cohort.length < 5) return absoluteSignal;
  const cohortSignal = percentileRank(value, cohort);
  return clamp(absoluteSignal * 0.75 + cohortSignal * 0.25, 0, 1);
}

function calibrateViralScore(compositeScore: number): number {
  // Maps a balanced composite of 50 to the middle tier while preserving room
  // above 95 for genuinely exceptional posts.
  return clamp(100 / (1 + Math.exp(-(compositeScore - 50) / 15)), 0, 100);
}

function logRangeSignal(value: number, lowerAnchor: number, upperAnchor: number): number {
  if (value <= lowerAnchor) return 0;
  if (value >= upperAnchor) return 1;
  const lower = Math.log1p(lowerAnchor);
  const upper = Math.log1p(upperAnchor);
  return clamp((Math.log1p(value) - lower) / Math.max(upper - lower, 1e-9), 0, 1);
}

function percentileRank(value: number, sortedValues: number[]): number {
  if (sortedValues.length <= 1) return 0.5;
  let lower = 0;
  let upper = sortedValues.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((sortedValues[middle] ?? 0) <= value) lower = middle + 1;
    else upper = middle;
  }
  return clamp((lower - 0.5) / sortedValues.length, 0, 1);
}

function effectiveMetricConfidence(post: RawPost): number {
  const confidence = computeMetricConfidence(post);
  return confidence > 0 ? confidence : 0.65;
}

function postAgeHours(createdAt: unknown, referenceTime: string): number {
  const created = parseDateTime(createdAt);
  const reference = parseDateTime(referenceTime);
  if (!created || !reference) return Number.POSITIVE_INFINITY;
  return Math.max(0, (reference.getTime() - created.getTime()) / 3_600_000);
}

function ageBucket(createdAt: unknown, referenceTime: string): string {
  const age = postAgeHours(createdAt, referenceTime);
  if (age <= 6) return "h00_06";
  if (age <= 24) return "h06_24";
  if (age <= 72) return "d01_03";
  if (age <= 168) return "d03_07";
  if (age <= 720) return "d07_30";
  return "d30_plus";
}

function emptyViralFeatureCohort(): ViralFeatureCohort {
  return {
    conversation: [],
    engagement: [],
    reach: [],
    spread: [],
    velocity: [],
  };
}

function numericAscending(left: number, right: number): number {
  return left - right;
}

function robustPeak(values: number[]): number {
  const positives = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (positives.length === 0) return 0;
  if (positives.length <= 4) return positives[positives.length - 1] ?? 0;
  const percentileIndex = Math.min(positives.length - 1, Math.max(0, Math.ceil(positives.length * 0.9) - 1));
  return positives[percentileIndex] ?? positives[positives.length - 1] ?? 0;
}

function weightedPostComponents(counts: {
  like_count: number;
  reply_count: number;
  repost_count: number;
  share_count: number;
}): WeightedPostComponents {
  const likeScore = counts.like_count;
  const replyScore = counts.reply_count * 2;
  const repostScore = counts.repost_count * 3;
  const shareScore = counts.share_count * 2;
  return {
    like_score: likeScore,
    reply_score: replyScore,
    repost_score: repostScore,
    share_score: shareScore,
    engagement_score: likeScore + replyScore + repostScore + shareScore,
  };
}

function normalizeWeights(weights: RankingWeights): RankingWeights {
  return {
    comments: numberValue(weights.comments),
    likes: numberValue(weights.likes),
    recency: numberValue(weights.recency),
    reposts: numberValue(weights.reposts),
    shares: numberValue(weights.shares),
    topic_match: numberValue(weights.topic_match),
    views: numberValue(weights.views),
  };
}

function weightedContribution(signal: number, weight: number, totalWeight: number): number {
  if (totalWeight <= 0 || weight <= 0) return 0;
  return clamp(signal, 0, 1) * (weight / totalWeight) * 100;
}

function normalizeMetric(value: number, peak: number): number {
  if (value <= 0 || peak <= 0) return 0;
  const numerator = Math.log1p(value);
  const denominator = Math.log1p(peak);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return clamp(numerator / denominator, 0, 1);
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateTime(value: unknown): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(String(value).replace(/Z$/, "Z"));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
