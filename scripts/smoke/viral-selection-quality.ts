import {
  evaluateRawPostForOutput,
  selectAcceptedPostResults,
  STRICT_BLANK_VIRAL_MIN_SCORE,
} from "../../apps/server/src/modules/crawl/selection/post-evaluation";
import {
  selectFinalPostsForOutput,
  selectPostsForDetail,
} from "../../apps/server/src/modules/crawl/collectors/threads-post-selection";
import {
  isAdaptiveViralReserveReady,
  shouldRetainDetailedPostForFinalComparison,
} from "../../apps/server/src/modules/crawl/collectors/threads-web";
import type {
  CrawlRequest,
  PostData,
  RawPost,
  TopicFilter,
} from "../../apps/server/src/modules/crawl/types";

const topic: TopicFilter = {
  category: "general",
  excluded_keywords: [],
  keywords: [],
  lexicon: {
    abbreviations: [],
    canonical: [],
    no_diacritics: [],
    teencode: [],
  },
  query_variants: [],
  required_keywords: [],
  required_keywords_mode: "all",
  search_queries: [],
  seed_post_urls: [],
  trend_search_urls: [],
  topic_intent: "Viral feed",
  topic_title: "Viral feed",
};

const request: CrawlRequest = {
  created_at: "2026-07-19T00:00:00Z",
  filters: {
    date_range: { end_date: "", preset: "", start_date: "" },
    exclude_commerce_content: true,
    exclude_posts_with_links: true,
    exclude_usernames: [],
    global_excluded_keywords: [],
    include_usernames: [],
    languages: ["vi"],
    max_posts_per_topic: 2,
    max_text_length: 0,
    min_comment_likes: 0,
    min_comments: 0,
    min_loaded_top_comments: 0,
    min_post_likes: 0,
    min_post_replies: 0,
    min_post_reposts: 0,
    min_post_score: 0,
    min_post_shares: 0,
    min_post_views: 2_500,
    min_text_length: 0,
    min_topic_match_score: 0,
    ranking_mode: "weighted",
    ranking_weights: {
      comments: 16,
      likes: 14,
      recency: 8,
      reposts: 22,
      shares: 20,
      topic_match: 0,
      views: 12,
    },
    recency_half_life_hours: 720,
    require_comments: false,
    require_metrics: true,
    require_repost_or_share: false,
    sort_by: "score",
    source: "threads",
    text_contains_all: [],
    text_contains_any: [],
    text_excludes_any: [],
    top_comments_per_post: 5,
    topics: [topic],
  },
  notes: "smoke",
  request_id: "viral-selection-quality",
};

const chromeOnlyPost = rawPost({
  post_id: "chrome-only",
  text: "viral\n22 giờ\n……",
  username: "chrome",
});
const chromeEvaluation = evaluateRawPostForOutput(
  chromeOnlyPost,
  topic,
  request,
  {
    skipLoadedCommentGate: true,
  }
);
if (
  chromeEvaluation.accepted ||
  chromeEvaluation.reason !== "viral_content_quality_too_low"
) {
  throw new Error(
    "Expected Threads UI chrome text to be rejected from blank viral feed."
  );
}

const weakScoreEvaluation = evaluateRawPostForOutput(
  rawPost({
    like_count: 600,
    post_id: "weak-score",
    quote_count: 0,
    reply_count: 0,
    repost_count: 0,
    share_count: 0,
    url: "https://www.threads.com/@weak-score/post/weak-score",
    username: "weak-score",
    view_count: 5_000,
  }),
  topic,
  request,
  { skipLoadedCommentGate: true }
);
if (
  weakScoreEvaluation.accepted ||
  weakScoreEvaluation.reason !== "score_below_minimum" ||
  Number(weakScoreEvaluation.score ?? 0) >= STRICT_BLANK_VIRAL_MIN_SCORE
) {
  throw new Error(
    `Expected blank Viral feed to reject posts below score ${STRICT_BLANK_VIRAL_MIN_SCORE}.`
  );
}

const unsafeFloorOverrideEvaluation = evaluateRawPostForOutput(
  weakScoreEvaluation.rawPost,
  topic,
  request,
  {
    skipLoadedCommentGate: true,
    viralScoreFloorOverride: 0,
  }
);
if (
  unsafeFloorOverrideEvaluation.accepted ||
  unsafeFloorOverrideEvaluation.reason !== "score_below_minimum"
) {
  throw new Error(
    `Expected an internal override to never lower the Viral feed floor below ${STRICT_BLANK_VIRAL_MIN_SCORE}.`
  );
}

const directPostLanguageEvaluation = evaluateRawPostForOutput(
  rawPost({
    language: "unknown",
    post_id: "direct-post-language",
    text: "外网已把毛姆这个meme发扬光大",
    url: "https://www.threads.com/@elefos_8964/post/DfBcaxmCUES",
    username: "elefos_8964",
  }),
  {
    ...topic,
    seed_post_urls: ["https://www.threads.com/share/JztICg2sa/"],
  },
  request,
  { skipLoadedCommentGate: true },
);
if (!directPostLanguageEvaluation.accepted) {
  throw new Error(
    `A directly pasted post must not be rejected by language detection: ${directPostLanguageEvaluation.reason}.`,
  );
}

const profileLanguageEvaluation = evaluateRawPostForOutput(
  directPostLanguageEvaluation.rawPost,
  {
    ...topic,
    seed_post_urls: ["https://www.threads.com/@elefos_8964"],
  },
  request,
  { skipLoadedCommentGate: true },
);
if (
  profileLanguageEvaluation.accepted ||
  profileLanguageEvaluation.reason !== "language_missing"
) {
  throw new Error(
    "Profile discovery must keep rejecting posts with unknown language when vi is required.",
  );
}

const ranked = [
  entry("a-high", "author-a", 100),
  entry("a-second", "author-a", 99),
  entry("b-high", "author-b", 90),
];
const selected = selectAcceptedPostResults(ranked, {
  limit: 2,
  maxPostsPerAuthor: 1,
  rankingMode: "weighted",
  sortBy: "score",
});
if (
  selected.map((item) => item.post.username).join(",") !== "author-a,author-b"
) {
  throw new Error(
    "Expected blank viral selection to prefer unique authors before duplicates."
  );
}

const detailPool = [
  ...Array.from({ length: 10 }, (_, index) =>
    rawPost({
      discovery_source: "home_feed",
      like_count: 30_000 - index * 1_000,
      post_id: `detail-home-${index}`,
      url: `https://www.threads.com/@detail-home-${index}/post/detail-home-${index}`,
      username: `detail-home-${index}`,
    })
  ),
  ...Array.from({ length: 3 }, (_, index) =>
    rawPost({
      discovery_source: "profile",
      like_count: 10_000 - index * 1_000,
      post_id: `detail-profile-${index}`,
      url: `https://www.threads.com/@detail-profile-${index}/post/detail-profile-${index}`,
      username: `detail-profile-${index}`,
    })
  ),
];
const detailSelected = selectPostsForDetail(
  detailPool,
  {
    includeHomeFeed: true,
    maxDetailRequests: 8,
    maxSearchQueriesPerTopic: 0,
    targetOutputPosts: 2,
  } as never,
  topic,
  request
);
const profileDetailCount = detailSelected.filter(
  (post) => post.discovery_source === "profile"
).length;
if (detailSelected.length !== 8 || profileDetailCount < 3) {
  throw new Error(
    `Expected the deep shortlist to reserve source-diversity slots, got total=${detailSelected.length} profile=${profileDetailCount}.`
  );
}
const earlyHomeFeedCount = detailSelected
  .slice(0, 5)
  .filter((post) => post.discovery_source === "home_feed").length;
if (earlyHomeFeedCount > 2) {
  throw new Error(
    `Expected source interleaving to keep the first five detail requests at no more than two Home feed posts, got ${earlyHomeFeedCount}.`
  );
}
const sourcePool = [
  rawPost({
    discovery_source: "home_feed",
    post_id: "home-1",
    url: "https://www.threads.com/@home-1/post/home-1",
    username: "home-1",
    like_count: 20_000,
  }),
  rawPost({
    discovery_source: "home_feed",
    post_id: "home-2",
    url: "https://www.threads.com/@home-2/post/home-2",
    username: "home-2",
    like_count: 19_000,
  }),
  rawPost({
    discovery_source: "home_feed",
    post_id: "home-3",
    url: "https://www.threads.com/@home-3/post/home-3",
    username: "home-3",
    like_count: 18_000,
  }),
  rawPost({
    discovery_source: "home_feed",
    post_id: "home-4",
    url: "https://www.threads.com/@home-4/post/home-4",
    username: "home-4",
    like_count: 17_000,
  }),
  rawPost({
    discovery_source: "profile",
    post_id: "profile-1",
    url: "https://www.threads.com/@profile-1/post/profile-1",
    username: "profile-1",
    like_count: 16_000,
  }),
  rawPost({
    discovery_source: "profile",
    post_id: "profile-2",
    url: "https://www.threads.com/@profile-2/post/profile-2",
    username: "profile-2",
    like_count: 15_000,
  }),
  rawPost({
    discovery_source: "profile",
    post_id: "profile-3",
    url: "https://www.threads.com/@profile-3/post/profile-3",
    username: "profile-3",
    like_count: 14_000,
  }),
];
const sourceDiverse = selectFinalPostsForOutput(sourcePool, topic, request, 5, {
  skipLoadedCommentGate: true,
});
const homeFeedCount = sourceDiverse.filter(
  (post) => post.discovery_source === "home_feed"
).length;
if (sourceDiverse.length !== 5 || homeFeedCount > 2) {
  throw new Error(
    `Expected five viral posts with at most two home-feed results when profile alternatives exist, got total=${sourceDiverse.length} home=${homeFeedCount}.`
  );
}

const insufficientSourcePool = [
  ...sourcePool.filter((post) => post.discovery_source === "home_feed"),
  ...sourcePool
    .filter((post) => post.discovery_source === "profile")
    .slice(0, 2),
];
const strictSourceResult = selectFinalPostsForOutput(
  insufficientSourcePool,
  topic,
  request,
  5,
  { skipLoadedCommentGate: true }
);
const strictHomeCount = strictSourceResult.filter(
  (post) => post.discovery_source === "home_feed"
).length;
if (strictSourceResult.length !== 4 || strictHomeCount !== 2) {
  throw new Error(
    `Expected strict Viral feed source cap to return an explicit shortfall instead of filling with Home feed, got total=${strictSourceResult.length} home=${strictHomeCount}.`
  );
}

const adaptivePool = Array.from({ length: 25 }, (_, index) =>
  rawPost({
    discovery_source: index < 10 ? "home_feed" : "profile",
    post_id: `adaptive-${index}`,
    url: `https://www.threads.com/@adaptive-${index}/post/adaptive-${index}`,
    username: `adaptive-${index}`,
  })
);
if (isAdaptiveViralReserveReady(adaptivePool.slice(0, 24), topic, request, 25)) {
  throw new Error("Adaptive Viral detail scan must not stop before its quality reserve is full.");
}
if (!isAdaptiveViralReserveReady(adaptivePool, topic, request, 25)) {
  throw new Error("Adaptive Viral detail scan should stop after 25 qualified, source-diverse posts.");
}

const smallAdaptivePool = adaptivePool.slice(0, 3).concat(adaptivePool.slice(10, 15));
if (isAdaptiveViralReserveReady(smallAdaptivePool.slice(0, 7), topic, request, 8)) {
  throw new Error("Target 5 backfill must not stop at the observed seven-or-fewer candidate shortfall.");
}
if (!isAdaptiveViralReserveReady(smallAdaptivePool, topic, request, 8)) {
  throw new Error("Target 5 backfill should stop once eight source-diverse candidates are ready.");
}
if (
  !shouldRetainDetailedPostForFinalComparison(false, true) ||
  shouldRetainDetailedPostForFinalComparison(false, false)
) {
  throw new Error(
    "Deep Viral comparison must retain provisional rejects until the complete pool is rescored.",
  );
}

console.log("smoke:viral-selection-quality ok");

function rawPost(overrides: Partial<RawPost>): RawPost {
  return {
    comments: [],
    created_at: "2026-07-18T12:00:00Z",
    crawled_at: "2026-07-19T00:00:00Z",
    display_name: "Demo",
    language: "vi",
    like_count: 10_000,
    media: [],
    post_id: "post",
    quote_count: 100,
    reply_count: 500,
    repost_count: 1_000,
    share_count: 1_000,
    text: "Một câu chuyện đang được chia sẻ và thảo luận rất mạnh trên Threads.",
    url: "https://www.threads.com/@demo/post/post",
    username: "demo",
    view_count: 500_000,
    ...overrides,
  };
}

function entry(
  postId: string,
  username: string,
  score: number
): {
  post: PostData;
  score: number;
  scoreBreakdown: Record<string, unknown>;
} {
  const raw = rawPost({ post_id: postId, username });
  return {
    post: {
      avatar_asset_path: "",
      avatar_url: "",
      crawled_at: String(raw.crawled_at),
      created_at: String(raw.created_at),
      discovery_source: "home_feed",
      discovery_window_end: "",
      discovery_window_start: "",
      display_name: username,
      language: "vi",
      like_count: Number(raw.like_count),
      matched_query: "",
      media: [],
      post_id: postId,
      quote_count: Number(raw.quote_count),
      ranking: {
        breakdown: {},
        final_score: score,
        mode: "weighted",
        sort_by: "score",
      },
      reply_count: Number(raw.reply_count),
      repost_count: Number(raw.repost_count),
      share_count: Number(raw.share_count),
      source_url: String(raw.url),
      text: String(raw.text),
      top_comments: [],
      url: String(raw.url),
      username,
      view_count: Number(raw.view_count),
    },
    score,
    scoreBreakdown: { final_score: score },
  };
}
