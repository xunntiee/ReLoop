import { evaluateRawPostForOutput } from "../../apps/server/src/modules/crawl/selection/post-evaluation";
import type { CrawlRequest, RawPost, TopicFilter } from "../../apps/server/src/modules/crawl/types";

const shareUrl = "https://www.threads.com/share/Fd4qGOkFe/";

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
  seed_post_urls: [shareUrl],
  trend_search_urls: [],
  topic_intent: "xam 1",
  topic_title: "xam 1",
};

const request: CrawlRequest = {
  created_at: "2026-07-30T07:50:00Z",
  filters: {
    date_range: { end_date: "", preset: "", start_date: "" },
    exclude_commerce_content: false,
    exclude_posts_with_links: false,
    exclude_usernames: [],
    global_excluded_keywords: [],
    include_usernames: [],
    languages: ["vi"],
    max_posts_per_topic: 1,
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
    min_topic_match_score: 0.2,
    ranking_mode: "weighted",
    ranking_weights: {
      comments: 1,
      likes: 1,
      recency: 0,
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
    text_excludes_any: [],
    top_comments_per_post: 10,
    topics: [topic],
  },
  notes: "direct share selection smoke",
  request_id: "direct-share-selection",
  runtime_overrides: {},
  ui_state: { advancedEnabled: false, sourceMode: "seed_only" },
};

const rawPost: RawPost = {
  avatar_asset_path: "",
  avatar_url: "",
  comments: [
    {
      comment_id: "c1",
      language: "vi",
      like_count: 12,
      media: [],
      reply_count: 0,
      text: "Binh luan hop le de dua vao video.",
      username: "viewer",
    },
  ],
  created_at: "2026-07-30T07:45:00Z",
  display_name: "demo",
  language: "vi",
  like_count: 1,
  media: [],
  post_id: "RealPostId123",
  quote_count: 0,
  reply_count: 1,
  repost_count: 0,
  share_count: 0,
  source_url: shareUrl,
  text: "Day la bai viet duoc dan truc tiep tu link share Threads.",
  url: "https://www.threads.com/@demo/post/RealPostId123",
  username: "demo",
  view_count: 10,
};

const evaluated = evaluateRawPostForOutput(rawPost, topic, request);

if (!evaluated.accepted) {
  throw new Error(`Expected direct Threads /share/ seed to bypass topic gate, got ${evaluated.reason}.`);
}

console.log("direct-share-selection: ok");