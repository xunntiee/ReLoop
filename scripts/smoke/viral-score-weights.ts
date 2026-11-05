import {
  buildPostMetricPeaks,
  computePostScoreBreakdown,
} from "../../apps/server/src/modules/crawl/ranking/viral-score";
import type {
  RankingWeights,
  RawPost,
} from "../../apps/server/src/modules/crawl/types";

const weights: RankingWeights = {
  comments: 16,
  likes: 14,
  recency: 8,
  reposts: 24,
  shares: 22,
  topic_match: 0,
  views: 8,
};

const basePost: RawPost = {
  comments: [],
  created_at: "2026-06-29T00:00:00Z",
  crawled_at: "2026-06-29T00:00:00Z",
  display_name: "demo",
  language: "vi",
  media: [],
  post_id: "base",
  quote_count: 0,
  text: "Mot bai viet binh thuong de test diem viral.",
  url: "https://www.threads.com/@demo/post/base",
  username: "demo",
};

const highViewWeak = post({
  like_count: 20,
  post_id: "high-view-weak",
  reply_count: 2,
  repost_count: 0,
  share_count: 0,
  text: "Bai co nhieu view nhung tuong tac yeu.",
  view_count: 50_000,
});

const redistributedViral = post({
  like_count: 180,
  post_id: "redistributed-viral",
  quote_count: 4,
  reply_count: 25,
  repost_count: 30,
  share_count: 12,
  text: "Mot cau chuyen dang duoc tranh luan va chia se rat manh.",
  view_count: 12_000,
});

const contaminatedQuestion = post({
  like_count: 18,
  post_id: "contaminated-question",
  reply_count: 40,
  repost_count: 40,
  share_count: 0,
  text: "Mn oi cho minh hoi co nen mua o dau ngon khong, rcm giup minh voi?",
  view_count: 6_000,
});

const lowLikeRedistributionNoise = post({
  created_at: "2026-06-18T11:21:19Z",
  like_count: 2,
  post_id: "low-like-redistribution-noise",
  reply_count: 21,
  repost_count: 9,
  share_count: 29,
  text: "TCB lap ky luc loi nhuan truoc thue va tap trung vao tep khach hang cao cap.",
  username: "investlens",
  view_count: 2_801,
});

const breakoutViral = post({
  created_at: "2026-06-28T12:00:00Z",
  like_count: 24_000,
  post_id: "breakout-viral",
  quote_count: 300,
  reply_count: 420,
  repost_count: 2_100,
  share_count: 1_400,
  text: "Mot bai viet bung no tren Threads voi luong chia se rat lon.",
  view_count: 520_000,
});

const missingViewStrong = post({
  created_at: "2026-02-21T03:59:46.000Z",
  like_count: 58_500,
  post_id: "missing-view-strong",
  reply_count: 2_700,
  repost_count: 14_800,
  share_count: 4_500,
  text: "Bai viral rat manh nhung Threads khong cung cap luot xem.",
  view_count: 0,
});
const metricPeaks = buildPostMetricPeaks([
  highViewWeak,
  redistributedViral,
  contaminatedQuestion,
  lowLikeRedistributionNoise,
  breakoutViral,
], "2026-06-29T00:00:00Z");

const highViewScore = score(highViewWeak);
const redistributedScore = score(redistributedViral);
const contaminatedScore = score(contaminatedQuestion);
const lowLikeNoiseScore = score(lowLikeRedistributionNoise);
const breakoutScore = score(breakoutViral);
const missingViewStrongScore = score(missingViewStrong);

if (redistributedScore.final <= highViewScore.final) {
  throw new Error(
    `Expected redistribution-heavy post to beat high-view weak post, got ${redistributedScore.final} <= ${highViewScore.final}.`,
  );
}

if (Number(contaminatedScore.breakdown.metric_reliability_reposts ?? 1) >= 1) {
  throw new Error("Expected duplicated reply/repost metric to reduce repost reliability.");
}

if (contaminatedScore.final >= redistributedScore.final) {
  throw new Error(
    `Expected contaminated recommendation question to rank below redistributed viral post, got ${contaminatedScore.final} >= ${redistributedScore.final}.`,
  );
}

if (lowLikeNoiseScore.final > 58) {
  throw new Error(
    `Expected low-like redistribution noise to be capped below viral tier, got ${lowLikeNoiseScore.final}.`,
  );
}

if (Number(lowLikeNoiseScore.breakdown.absolute_viral_ceiling ?? 100) > 58) {
  throw new Error("Expected low-like redistribution noise to receive a low absolute viral ceiling.");
}

if (breakoutScore.final <= redistributedScore.final || breakoutScore.final >= 100) {
  throw new Error(
    `Expected breakout post to outrank normal viral content without saturating at 100, got breakout=${breakoutScore.final} normal=${redistributedScore.final}.`,
  );
}

if (missingViewStrongScore.final < 60) {
  throw new Error(
    `Expected strong missing-view post to remain in viral tier, got ${missingViewStrongScore.final}.`,
  );
}

if (Number(missingViewStrongScore.breakdown.estimated_views_used ?? 0) <= 0) {
  throw new Error("Expected missing-view post to use an internal reach estimate.");
}

if (Number(breakoutScore.breakdown.viral_score_version ?? 0) !== 3) {
  throw new Error("Expected Viral Score V3 breakdown metadata.");
}

console.log("smoke:viral-score-weights ok");

function post(overrides: Partial<RawPost>): RawPost {
  return {
    ...basePost,
    ...overrides,
  };
}

function score(rawPost: RawPost): {
  breakdown: Record<string, number>;
  final: number;
} {
  const breakdown = computePostScoreBreakdown(rawPost, {
    matchScore: 0,
    metricPeaks,
    rankingMode: "weighted",
    rankingWeights: weights,
    referenceTime: "2026-06-29T00:00:00Z",
    recencyHalfLifeHours: 168,
    sortBy: "score",
  });
  return {
    breakdown,
    final: Number(breakdown.final_score ?? 0),
  };
}
