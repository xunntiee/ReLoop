import { buildResumeRequestFromOutput, type CrawlRun } from "../../apps/server/src/modules/crawl/service";
import { evaluateRawPostForOutput } from "../../apps/server/src/modules/crawl/selection/post-evaluation";
import type { RawPost, TopicData } from "../../apps/server/src/modules/crawl/types";

const pendingUrl = "https://www.threads.com/@demo/post/pending-weak";

const output: TopicData[] = [
  {
    crawled_at: "2026-06-26T00:00:00Z",
    crawl_audit: {
      partial_output: true,
      pending_post_urls: [pendingUrl],
      resume_seed_urls: [pendingUrl],
    },
    keywords: [],
    posts: [],
    request_meta: {
      created_at: "2026-06-26T00:00:00Z",
      date_range: { end_date: "", preset: "", start_date: "" },
      exclude_commerce_content: true,
      exclude_posts_with_links: true,
      exclude_usernames: [],
      global_excluded_keywords: [],
      include_usernames: [],
      languages: ["vi"],
      max_posts_per_topic: 3,
      max_text_length: 2000,
      min_comment_likes: 0,
      min_comments: 3,
      min_loaded_top_comments: 1,
      min_post_likes: 0,
      min_post_replies: 0,
      min_post_reposts: 0,
      min_post_score: 0,
      min_post_shares: 0,
      min_post_views: 1000,
      min_text_length: 0,
      min_topic_match_score: 0,
      notes: "",
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
      request_id: "resume-quality-source",
      require_comments: false,
      require_metrics: true,
      require_repost_or_share: false,
      runtime_overrides: {},
      sort_by: "score",
      source: "threads",
      text_contains_all: [],
      text_contains_any: [],
      text_excludes_any: [],
      top_comments_per_post: 5,
      topic: {
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
      ui_state: {},
    },
    source: "threads",
    topic_id: "topic-viral-feed",
    topic_title: "Viral feed",
  },
];

const run: CrawlRun = {
  configPath: "",
  id: "crawl-resume-quality-source",
  outputPath: "resume-quality-source.json",
  progress: {
    pending_posts: 1,
    stage: "completed",
    target_output_posts: 3,
    updated_at: "2026-06-26T00:00:00Z",
  },
  queuedAt: "2026-06-26T00:00:00Z",
  startedAt: "2026-06-26T00:00:00Z",
  status: "stopped_partial",
  topics: ["Viral feed"],
};

const resumedRequest = buildResumeRequestFromOutput(output, run);
const topic = resumedRequest.filters.topics[0];
if (!topic || topic.seed_post_urls[0] !== pendingUrl) {
  throw new Error("Expected resume request to carry the pending URL as seed.");
}
if (resumedRequest.ui_state?.resume_requires_viral_signal_floor !== true) {
  throw new Error("Expected resume request to keep viral signal floor enabled.");
}

const weakPost: RawPost = {
  comments: [],
  created_at: "2026-06-26T00:00:00Z",
  crawled_at: "2026-06-26T00:00:00Z",
  display_name: "Weak Demo",
  language: "vi",
  like_count: 2,
  matched_query: "seed_post_urls",
  media: [],
  post_id: "pending-weak",
  quote_count: 0,
  reply_count: 0,
  repost_count: 0,
  share_count: 0,
  source_url: pendingUrl,
  text: "Bai nay qua yeu nen khong nen vao output viral feed.",
  url: pendingUrl,
  username: "demo",
  view_count: 100,
};

const evaluated = evaluateRawPostForOutput(weakPost, topic, resumedRequest);
if (evaluated.accepted || evaluated.reason !== "viral_signal_too_weak") {
  throw new Error(
    `Expected weak resumed viral seed to be rejected by viral floor, got accepted=${String(evaluated.accepted)} reason=${evaluated.reason}`,
  );
}

console.log("smoke:resume-viral-quality-floor ok");
