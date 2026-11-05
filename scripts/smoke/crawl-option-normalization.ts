import { normalizeRequestDefaults } from "../../apps/server/src/modules/crawl/service";
import type { CrawlRequest } from "../../apps/server/src/modules/crawl/types";

const request = {
  created_at: "2026-07-11T00:00:00.000Z",
  filters: {
    date_range: {
      end_date: "",
      preset: "",
      start_date: "",
      timezone: "Asia/Bangkok",
    },
    exclude_commerce_content: true,
    exclude_posts_with_links: true,
    exclude_usernames: [],
    global_excluded_keywords: ["sponsor"],
    include_usernames: [],
    languages: ["vi", "en"],
    max_posts_per_topic: 3,
    max_text_length: 2000,
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
    min_topic_match_score: 0.1,
    ranking_mode: "weighted",
    ranking_weights: {
      comments: 1,
      likes: 1,
      recency: 1,
      reposts: 1,
      shares: 1,
      topic_match: 1,
      views: 1,
    },
    recency_half_life_hours: 168,
    require_comments: false,
    require_metrics: false,
    require_repost_or_share: false,
    sort_by: "score",
    source: "threads",
    text_contains_all: [],
    text_contains_any: [],
    text_excludes_any: ["giveaway"],
    top_comments_per_post: 2,
    topics: [
      {
        category: "sports",
        excluded_keywords: ["betting"],
        keywords: ["world cup"],
        lexicon: {
          abbreviations: [],
          canonical: [],
          no_diacritics: [],
          teencode: [],
        },
        query_variants: [],
        required_keywords: [],
        required_keywords_mode: "any",
        search_queries: ["world cup"],
        seed_post_urls: ["https://m.threads.net/@demo/post/ABC?x=1"],
        topic_intent: "world cup",
        topic_title: "World cup",
        trend_search_urls: [],
      },
    ],
  },
  notes: "",
  request_id: "option-normalization",
} satisfies CrawlRequest;

normalizeRequestDefaults(request, {
  crawl: { baseUrl: "https://www.threads.com" },
} as never);

if (!request.filters.exclude_posts_with_links || !request.filters.exclude_commerce_content) {
  throw new Error("Expected server normalization to preserve exclusion toggles.");
}
if (request.filters.text_excludes_any[0] !== "giveaway" || request.filters.global_excluded_keywords[0] !== "sponsor") {
  throw new Error("Expected server normalization to preserve global exclusion terms.");
}
if (request.filters.topics[0]?.excluded_keywords[0] !== "betting") {
  throw new Error("Expected server normalization to preserve topic exclusion terms.");
}
if (request.filters.topics[0]?.seed_post_urls[0] !== "https://www.threads.com/@demo/post/ABC") {
  throw new Error("Expected server normalization to canonicalize direct post URLs.");
}

const advancedBlankRequest = structuredClone(request);
advancedBlankRequest.request_id = "advanced-blank-options";
advancedBlankRequest.ui_state = { advancedEnabled: true };
advancedBlankRequest.filters.exclude_commerce_content = false;
advancedBlankRequest.filters.exclude_posts_with_links = false;
advancedBlankRequest.filters.min_comments = 0;
advancedBlankRequest.filters.min_loaded_top_comments = 0;
advancedBlankRequest.filters.min_post_views = 0;
advancedBlankRequest.filters.require_metrics = false;
advancedBlankRequest.filters.topics[0] = {
  ...advancedBlankRequest.filters.topics[0]!,
  keywords: [],
  required_keywords: [],
  search_queries: [],
  seed_post_urls: [],
  topic_intent: "Viral feed",
  topic_title: "Viral feed",
};
normalizeRequestDefaults(advancedBlankRequest, {
  crawl: { baseUrl: "https://www.threads.com" },
} as never);
if (
  advancedBlankRequest.filters.min_post_views !== 0 ||
  advancedBlankRequest.filters.min_comments !== 0 ||
  advancedBlankRequest.filters.require_metrics
) {
  throw new Error("Expected explicit advanced options to bypass implicit blank-feed floors.");
}

console.log("smoke:crawl-option-normalization ok");
