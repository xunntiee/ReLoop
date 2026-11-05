import { buildResumeRequestFromOutput, type CrawlRun } from "../../apps/server/src/modules/crawl/service";

const completedUrls = [
  "https://www.threads.com/@thu_thao_ng/post/DaCVELwkTnC",
  "https://www.threads.com/@thuonglun00/post/DaCZ9Y9mgEM",
];

const output = [
  {
    crawled_at: "2026-06-26T07:46:38Z",
    crawl_audit: {
      completed_post_urls: completedUrls,
      partial_output: true,
      pending_post_urls: completedUrls,
      resume_seed_urls: completedUrls,
    },
    keywords: [],
    posts: completedUrls.map((url, index) => ({
      avatar_asset_path: "",
      avatar_url: "",
      created_at: "2026-06-26T00:00:00Z",
      crawled_at: "2026-06-26T00:00:00Z",
      display_name: `Demo ${index + 1}`,
      language: "vi",
      like_count: 10,
      media: [],
      post_id: `post-${index + 1}`,
      quote_count: 0,
      ranking: {
        breakdown: {},
        final_score: 1,
        mode: "weighted",
        sort_by: "score",
      },
      reply_count: 10,
      repost_count: 1,
      share_count: 1,
      source_url: url,
      text: `Noi dung bai ${index + 1}`,
      top_comments: Array.from({ length: 5 }, (_, commentIndex) => ({
        avatar_asset_path: "",
        avatar_url: "",
        comment_id: `comment-${index + 1}-${commentIndex + 1}`,
        created_at: "2026-06-26T00:00:00Z",
        display_name: `Comment ${commentIndex + 1}`,
        language: "vi",
        like_count: commentIndex + 1,
        media: [],
        reply_count: 0,
        source_order: commentIndex + 1,
        text: `Binh luan ${commentIndex + 1}`,
        username: `user${commentIndex + 1}`,
      })),
      url,
      username: `demo${index + 1}`,
      view_count: 5000,
    })),
    request_meta: {
      created_at: "2026-06-26T07:41:26Z",
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
      max_posts_per_topic: 6,
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
      min_text_length: 10,
      min_topic_match_score: 0.05,
      notes: "Created from Crawl Console UI.",
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
      request_id: "threads-viral-feed-all-p6-c5-20260626144126881",
      require_comments: false,
      require_metrics: true,
      require_repost_or_share: false,
      runtime_overrides: {
        includeHomeFeed: false,
        maxCandidateLinks: 12,
        maxCollectedPostsPerTopic: 6,
        maxSearchQueriesPerTopic: 2,
      },
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
      ui_state: {
        includeHomeFeed: false,
        maxSearchQueriesPerTopic: 2,
        wantedPosts: 6,
      },
    },
    source: "threads",
    topic_id: "topic-viral-feed",
    topic_title: "Viral feed",
  },
];

const run: CrawlRun = {
  configPath: "",
  id: "crawl-20260626144126-001",
  outputPath: "resume-source.json",
  progress: {
    comment_completed: 10,
    comment_target: 30,
    committed_comments: 10,
    committed_posts: 2,
    stage: "completed",
    summary_posts: 2,
    target_output_posts: 6,
    updated_at: "2026-06-26T07:46:38Z",
  },
  queuedAt: "2026-06-26T07:41:26Z",
  startedAt: "2026-06-26T07:41:26Z",
  status: "stopped_partial",
  topics: ["Viral feed"],
};

const resumed = buildResumeRequestFromOutput(output, run);

if (resumed.filters.max_posts_per_topic !== 4) {
  throw new Error(
    `Expected resume request to chase remaining 4 posts, got ${resumed.filters.max_posts_per_topic}.`,
  );
}

if (Number(resumed.runtime_overrides?.maxSearchQueriesPerTopic ?? 0) !== 2) {
  throw new Error(
    `Expected resume request to preserve discovery backfill with 2 search queries, got ${String(resumed.runtime_overrides?.maxSearchQueriesPerTopic)}.`,
  );
}

if (resumed.runtime_overrides?.includeHomeFeed !== false) {
  throw new Error("Expected resume request to preserve includeHomeFeed=false from the original run.");
}

if (resumed.ui_state?.sourceMode !== "resume_mixed") {
  throw new Error(
    `Expected resume request to mark sourceMode=resume_mixed, got ${String(resumed.ui_state?.sourceMode)}.`,
  );
}

const resumeCompletedUrls = Array.isArray(resumed.ui_state?.resume_completed_urls)
  ? resumed.ui_state.resume_completed_urls
  : [];

if (resumeCompletedUrls.length !== 2) {
  throw new Error(
    `Expected resume request to carry 2 completed URLs for dedupe, got ${resumeCompletedUrls.length}.`,
  );
}

console.log("smoke:resume-discovery-backfill ok");
