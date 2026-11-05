import { ThreadsWebCollector } from "../../apps/server/src/modules/crawl/collectors/threads-web";
import { THREADS_EXTRACTION_VERSION } from "../../apps/server/src/modules/crawl/collectors/threads-cache";
import type {
  CrawlRequest,
  RawComment,
  RawPost,
  TopicFilter,
} from "../../apps/server/src/modules/crawl/types";

const topic: TopicFilter = {
  category: "smoke",
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
  topic_intent: "viral feed",
  topic_title: "Viral feed",
};

function buildRequest(minTextLength: number): CrawlRequest {
  return {
    created_at: "2026-06-26T00:00:00Z",
    filters: {
      date_range: {
        end_date: "2026-06-26",
        preset: "custom",
        start_date: "2026-06-01",
      },
      exclude_commerce_content: false,
      exclude_posts_with_links: false,
      exclude_usernames: [],
      global_excluded_keywords: [],
      include_usernames: [],
      languages: ["vi"],
      max_posts_per_topic: 5,
      max_text_length: 5000,
      min_comment_likes: 0,
      min_comments: 0,
      min_loaded_top_comments: 0,
      min_post_likes: 0,
      min_post_replies: 0,
      min_post_reposts: 0,
      min_post_score: 0,
      min_post_shares: 0,
      min_post_views: 0,
      min_text_length: minTextLength,
      min_topic_match_score: 0,
      ranking_mode: "weighted",
      ranking_weights: {
        comments: 0.2,
        likes: 0.1,
        recency: 0.05,
        reposts: 0.1,
        shares: 0.05,
        topic_match: 0.1,
        views: 0.4,
      },
      recency_half_life_hours: 48,
      require_comments: false,
      require_metrics: false,
      require_repost_or_share: false,
      sort_by: "views",
      source: "threads",
      text_contains_all: [],
      text_contains_any: [],
      text_excludes_any: [],
      top_comments_per_post: 5,
      topics: [topic],
    },
    notes: "smoke stop preview truth",
    request_id: `smoke-stop-preview-truth-${minTextLength}`,
    runtime_overrides: {},
    ui_state: { advancedEnabled: true },
  };
}

function makeComment(index: number, text: string): RawComment {
  return {
    avatar_url: "",
    comment_id: `comment-${index}`,
    created_at: "2026-06-26T00:00:00Z",
    display_name: `Comment ${index}`,
    language: "vi",
    like_count: index,
    media: [],
    reply_count: 0,
    text,
    username: `commenter${index}`,
  };
}

function makePost(index: number, text: string, commentText: string): RawPost {
  return {
    avatar_url: "",
    comments: Array.from({ length: 10 }, (_, commentIndex) =>
      makeComment(index * 100 + commentIndex + 1, commentText),
    ),
    created_at: "2026-06-26T00:00:00Z",
    crawled_at: "2026-06-26T00:00:00Z",
    display_name: `Post ${index}`,
    language: "vi",
    like_count: 240 + index,
    matched_query: "viral",
    media: [],
    metrics_snapshot: {
      crawled_at: "2026-06-26T00:00:00Z",
      extraction_depth: "full",
      extraction_version: THREADS_EXTRACTION_VERSION,
    },
    post_id: `post-${index}`,
    quote_count: 0,
    reply_count: 30,
    repost_count: 10,
    share_count: 6,
    source_url: `https://www.threads.com/@demo/post/post-${index}`,
    text,
    url: `https://www.threads.com/@demo/post/post-${index}`,
    username: `demo${index}`,
    view_count: 25_000 + index,
  };
}

const truthyCollector = new ThreadsWebCollector({
  maxCollectedPostsPerTopic: 5,
  selectionRequest: buildRequest(10),
  summaryFirst: false,
  targetOutputPosts: 5,
});

const truthySnapshot = (
  truthyCollector as unknown as {
    resolveReadyOutputSnapshot: (
      posts: RawPost[],
      topic: TopicFilter,
    ) => { commentCount: number; posts: RawPost[] };
  }
).resolveReadyOutputSnapshot(
  [
    makePost(1, "Noi dung bai mot du dai de qua filter", "x"),
    makePost(2, "Noi dung bai hai du dai de qua filter", "x"),
  ],
  topic,
);

if (truthySnapshot.posts.length !== 2) {
  throw new Error(`Expected 2 previewable posts, got ${truthySnapshot.posts.length}.`);
}

if (truthySnapshot.commentCount !== 0) {
  throw new Error(`Expected 0 accepted comments after filtering, got ${truthySnapshot.commentCount}.`);
}

const strictCollector = new ThreadsWebCollector({
  maxCollectedPostsPerTopic: 5,
  selectionRequest: buildRequest(60),
  summaryFirst: false,
  targetOutputPosts: 5,
});

const strictSnapshot = (
  strictCollector as unknown as {
    resolveReadyOutputSnapshot: (
      posts: RawPost[],
      topic: TopicFilter,
    ) => { commentCount: number; posts: RawPost[] };
  }
).resolveReadyOutputSnapshot(
  [
    makePost(11, "qua ngan", "Binh luan hop le"),
    makePost(12, "van qua ngan", "Binh luan hop le"),
  ],
  topic,
);

if (strictSnapshot.posts.length !== 0 || strictSnapshot.commentCount !== 0) {
  throw new Error(
    `Expected no previewable output when posts fail final filter, got posts=${strictSnapshot.posts.length} comments=${strictSnapshot.commentCount}.`,
  );
}

console.log("smoke:stop-preview-truth ok");
