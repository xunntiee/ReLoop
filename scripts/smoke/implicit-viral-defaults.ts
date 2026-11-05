import { applyImplicitViralFeedDefaults } from "../../apps/server/src/modules/crawl/service";
import { selectFinalPostsForOutput } from "../../apps/server/src/modules/crawl/collectors/threads-post-selection";
import {
  evaluateRawPostForOutput,
  resolveAcceptedPostSelectionStrategy,
} from "../../apps/server/src/modules/crawl/selection/post-evaluation";
import type { CrawlRequest, RawPost } from "../../apps/server/src/modules/crawl/types";

const request: CrawlRequest = {
  created_at: "2026-06-26T00:00:00Z",
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
    languages: ["vi"],
    max_posts_per_topic: 5,
    max_text_length: 0,
    min_comment_likes: 0,
    min_comments: 0,
    min_loaded_top_comments: 0,
    min_post_likes: 0,
    min_post_replies: 0,
    min_post_reposts: 0,
    min_post_score: 0,
    min_post_shares: 0,
    min_post_views: 0,
    min_text_length: 0,
    min_topic_match_score: 0,
    ranking_mode: "weighted",
    ranking_weights: {
      comments: 20,
      likes: 5,
      recency: 3,
      reposts: 12,
      shares: 5,
      topic_match: 5,
      views: 50,
    },
    recency_half_life_hours: 168,
    require_comments: false,
    require_metrics: false,
    require_repost_or_share: false,
    sort_by: "views",
    source: "threads",
    text_contains_all: [],
    text_contains_any: [],
    text_excludes_any: [],
    top_comments_per_post: 5,
    topics: [
      {
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
        required_keywords_mode: "any",
        search_queries: [],
        seed_post_urls: [],
        topic_intent: "Viral feed",
        topic_title: "Viral feed",
      },
    ],
  },
  notes: "smoke implicit viral defaults",
  request_id: "smoke-implicit-viral-defaults",
  runtime_overrides: {},
};

applyImplicitViralFeedDefaults(request);

if (request.filters.min_post_views !== 2500) {
  throw new Error(
    `Expected strict blank viral defaults to apply a 2500-view sanity floor, got ${request.filters.min_post_views}.`,
  );
}

if (request.filters.min_post_score !== 55) {
  throw new Error(
    `Expected strict blank viral defaults to require score 55, got ${request.filters.min_post_score}.`,
  );
}

if (request.filters.require_metrics !== true) {
  throw new Error("Expected strict blank viral defaults to keep require_metrics enabled.");
}

if (request.filters.min_comments !== 5) {
  throw new Error(`Expected strict blank viral defaults to require at least 5 comments, got ${request.filters.min_comments}.`);
}

if (request.filters.min_loaded_top_comments !== 2) {
  throw new Error(
    `Expected strict blank viral defaults to require at least 2 loaded comments, got ${request.filters.min_loaded_top_comments}.`,
  );
}

if (request.filters.exclude_commerce_content !== true) {
  throw new Error("Expected strict blank viral defaults to exclude commerce content.");
}

if (request.filters.exclude_posts_with_links !== true) {
  throw new Error("Expected strict blank viral defaults to exclude posts with links.");
}

if (request.filters.sort_by !== "score") {
  throw new Error(`Expected strict blank viral defaults to force sort_by=score, got ${request.filters.sort_by}.`);
}

if (request.filters.date_range.preset !== "") {
  throw new Error(
    `Expected blank viral feed to avoid forcing a date preset, got ${request.filters.date_range.preset}.`,
  );
}

const expectedWeights = {
  comments: 16,
  likes: 14,
  recency: 8,
  reposts: 22,
  shares: 20,
  topic_match: 0,
  views: 12,
};
for (const [key, expected] of Object.entries(expectedWeights)) {
  const actual = request.filters.ranking_weights[key as keyof typeof expectedWeights];
  if (actual !== expected) {
    throw new Error(`Expected ${key} weight ${expected}, got ${actual}.`);
  }
}

if (request.filters.recency_half_life_hours !== 720) {
  throw new Error(
    `Expected blank viral feed to use 720h recency half-life, got ${request.filters.recency_half_life_hours}.`,
  );
}

const topic = request.filters.topics[0];
if (!topic) {
  throw new Error("Expected smoke request to have a topic.");
}

const selectionStrategy = resolveAcceptedPostSelectionStrategy(topic, {
  dateRange: request.filters.date_range,
  sortBy: request.filters.sort_by,
});
if (selectionStrategy !== "top_score") {
  throw new Error(
    `Expected blank viral feed to keep only the highest-scoring posts, got ${selectionStrategy}.`,
  );
}

const weakPost: RawPost = {
  comments: [],
  created_at: "2026-06-26T00:00:00Z",
  crawled_at: "2026-06-26T00:00:00Z",
  display_name: "Weak viral",
  language: "vi",
  like_count: 16,
  media: [],
  post_id: "weak-viral",
  quote_count: 0,
  reply_count: 46,
  repost_count: 46,
  share_count: 2,
  text: "kn 100n yeu nhau thi nen tang gi cho ny aaa mng rcm giup e voi a",
  url: "https://www.threads.com/@demo/post/weak-viral",
  username: "demo",
  view_count: 2494,
};
const weakEvaluation = evaluateRawPostForOutput(weakPost, topic, request);
if (weakEvaluation.accepted || weakEvaluation.reason !== "viral_signal_too_weak") {
  throw new Error(
    `Expected low-view recommendation bait to be rejected by viral floor, got accepted=${String(weakEvaluation.accepted)} reason=${weakEvaluation.reason}`,
  );
}

const lowLikeRedistributionNoise: RawPost = {
  comments: [
    {
      comment_id: "finance-c1",
      language: "vi",
      like_count: 1,
      reply_count: 0,
      text: "thong tin hay",
      username: "reader",
    },
    {
      comment_id: "finance-c2",
      language: "vi",
      like_count: 1,
      reply_count: 0,
      text: "cam on ban",
      username: "reader2",
    },
  ],
  created_at: "2026-06-18T11:21:19Z",
  crawled_at: "2026-06-29T00:00:00Z",
  display_name: "Investlens",
  language: "vi",
  like_count: 2,
  media: [],
  post_id: "low-like-redistribution-noise",
  quote_count: 0,
  reply_count: 21,
  repost_count: 9,
  share_count: 29,
  text: "TCB lap ky luc loi nhuan truoc thue va tap trung vao tep khach hang cao cap.",
  url: "https://www.threads.com/@investlens/post/low-like-redistribution-noise",
  username: "investlens",
  view_count: 2_801,
};
const lowLikeNoiseEvaluation = evaluateRawPostForOutput(
  lowLikeRedistributionNoise,
  topic,
  request,
);
if (
  lowLikeNoiseEvaluation.accepted ||
  lowLikeNoiseEvaluation.reason !== "viral_signal_too_weak"
) {
  throw new Error(
    `Expected low-like redistribution noise to be rejected by viral floor, got accepted=${String(lowLikeNoiseEvaluation.accepted)} reason=${lowLikeNoiseEvaluation.reason}`,
  );
}

const commercePost: RawPost = {
  ...weakPost,
  comments: [
    {
      comment_id: "c1",
      language: "vi",
      like_count: 5,
      reply_count: 0,
      text: "hay qua",
      username: "commenter",
    },
    {
      comment_id: "c2",
      language: "vi",
      like_count: 3,
      reply_count: 0,
      text: "dong y",
      username: "commenter2",
    },
  ],
  like_count: 220,
  post_id: "commerce-viral",
  reply_count: 70,
  repost_count: 25,
  share_count: 8,
  text: "Hoa trai cay tham khao minh nha za tot 99k zalo rcm giup e voi",
  url: "https://www.threads.com/@demo/post/commerce-viral",
  view_count: 30_000,
};
const commerceEvaluation = evaluateRawPostForOutput(commercePost, topic, request);
if (commerceEvaluation.accepted || commerceEvaluation.reason !== "commerce_content_detected") {
  throw new Error(
    `Expected commerce-like viral candidate to be rejected, got accepted=${String(commerceEvaluation.accepted)} reason=${commerceEvaluation.reason}`,
  );
}

const genericQuestionPost: RawPost = {
  ...weakPost,
  comments: [
    {
      comment_id: "generic-c1",
      language: "vi",
      like_count: 12,
      reply_count: 0,
      text: "cung thac mac",
      username: "reader",
    },
    {
      comment_id: "generic-c2",
      language: "vi",
      like_count: 8,
      reply_count: 0,
      text: "khong biet nua",
      username: "reader2",
    },
  ],
  like_count: 180,
  post_id: "generic-question",
  reply_count: 84,
  repost_count: 8,
  share_count: 12,
  text: "Mọi người nghĩ sao về vấn đề này? #thacmac",
  url: "https://www.threads.com/@demo/post/generic-question",
  view_count: 22_000,
};
const genericQuestionEvaluation = evaluateRawPostForOutput(
  genericQuestionPost,
  topic,
  request,
);
if (
  genericQuestionEvaluation.accepted ||
  genericQuestionEvaluation.reason !== "viral_content_quality_too_low"
) {
  throw new Error(
    `Expected generic question bait to be rejected by content quality gate, got accepted=${String(genericQuestionEvaluation.accepted)} reason=${genericQuestionEvaluation.reason}`,
  );
}

const lowScoreViralFloorPost: RawPost = {
  ...weakPost,
  comments: [
    {
      comment_id: "low-score-c1",
      language: "vi",
      like_count: 3,
      reply_count: 0,
      text: "noi dung binh luan mot",
      username: "reader1",
    },
    {
      comment_id: "low-score-c2",
      language: "vi",
      like_count: 2,
      reply_count: 0,
      text: "noi dung binh luan hai",
      username: "reader2",
    },
  ],
  like_count: 500,
  post_id: "low-score-floor",
  reply_count: 5,
  repost_count: 0,
  share_count: 0,
  text: "Mot bai co du luot thich so bo nhung chua du diem viral tong hop.",
  url: "https://www.threads.com/@demo/post/low-score-floor",
  view_count: 5_000,
};
const lowScoreViralFloorEvaluation = evaluateRawPostForOutput(
  lowScoreViralFloorPost,
  topic,
  request,
);
if (
  lowScoreViralFloorEvaluation.accepted ||
  lowScoreViralFloorEvaluation.reason !== "score_below_minimum"
) {
  throw new Error(
    `Expected final viral score floor rejection, got accepted=${String(lowScoreViralFloorEvaluation.accepted)} reason=${lowScoreViralFloorEvaluation.reason}.`,
  );
}

const finalSelectionPosts = selectFinalPostsForOutput(
  [
    {
      ...weakPost,
      comments: [
        {
          comment_id: "mid-c1",
          language: "vi",
          like_count: 10,
          reply_count: 0,
          text: "dong y",
          username: "reader",
        },
        {
          comment_id: "mid-c2",
          language: "vi",
          like_count: 8,
          reply_count: 0,
          text: "hay",
          username: "reader2",
        },
      ],
      discovery_source: "profile",
      like_count: 8_000,
      post_id: "mid-final",
      reply_count: 420,
      repost_count: 400,
      share_count: 800,
      text: "Một câu chuyện về áp lực tuổi hai mươi và cách nhiều người học cách tự đứng dậy sau biến cố.",
      url: "https://www.threads.com/@demo/post/mid-final",
      view_count: 400_000,
    },
    {
      ...weakPost,
      comments: [
        {
          comment_id: "best-c1",
          language: "vi",
          like_count: 20,
          reply_count: 0,
          text: "qua dung",
          username: "reader",
        },
        {
          comment_id: "best-c2",
          language: "vi",
          like_count: 12,
          reply_count: 0,
          text: "dang suy nghi",
          username: "reader2",
        },
      ],
      discovery_source: "home_feed",
      like_count: 10_000,
      post_id: "best-final",
      reply_count: 500,
      repost_count: 500,
      share_count: 1_000,
      text: "Unpopular opinion nhung minh nghi day la van de rat nhieu nguoi gap.",
      url: "https://www.threads.com/@demo/post/best-final",
      view_count: 500_000,
    },
    {
      ...weakPost,
      comments: [
        {
          comment_id: "low-c1",
          language: "vi",
          like_count: 3,
          reply_count: 0,
          text: "ok",
          username: "reader",
        },
        {
          comment_id: "low-c2",
          language: "vi",
          like_count: 2,
          reply_count: 0,
          text: "hmm",
          username: "reader2",
        },
      ],
      like_count: 55,
      post_id: "low-final",
      reply_count: 12,
      text: "Co ai nhu minh khong.",
      url: "https://www.threads.com/@demo/post/low-final",
      view_count: 8_200,
    },
  ],
  topic,
  {
    ...request,
    filters: {
      ...request.filters,
      max_posts_per_topic: 2,
    },
  },
  2,
);
if (
  finalSelectionPosts.length !== 2 ||
  !finalSelectionPosts.some((post) => post.post_id === "best-final") ||
  !finalSelectionPosts.some((post) => post.post_id === "mid-final") ||
  finalSelectionPosts.some((post) => post.post_id === "low-final")
) {
  throw new Error(
    `Expected final detail rerank to choose the strongest posts, got ${finalSelectionPosts.map((post) => post.post_id).join(", ")}`,
  );
}

console.log("smoke:implicit-viral-defaults ok");
