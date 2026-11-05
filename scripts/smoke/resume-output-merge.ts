import { mergeTopicOutputs } from "../../apps/server/src/modules/crawl/service";
import type { TopicData } from "../../apps/server/src/modules/crawl/types";

const previous: TopicData[] = [
  {
    crawled_at: "2026-06-26T00:00:00Z",
    crawl_audit: {
      completed_post_urls: [
        "https://www.threads.com/@demo/post/post-1",
        "https://www.threads.com/@demo/post/post-2",
      ],
      partial_output: true,
      pending_post_urls: ["https://www.threads.com/@demo/post/post-3"],
      resume_seed_urls: ["https://www.threads.com/@demo/post/post-3"],
    },
    keywords: [],
    posts: [
      {
        avatar_url: "",
        created_at: "",
        crawled_at: "",
        display_name: "demo-1",
        language: "vi",
        like_count: 0,
        media: [],
        post_id: "post-1",
        ranking: { breakdown: {}, final_score: 1, mode: "weighted", sort_by: "views" },
        reply_count: 0,
        repost_count: 0,
        share_count: 0,
        source_url: "https://www.threads.com/@demo/post/post-1",
        text: "post 1",
        top_comments: [],
        url: "https://www.threads.com/@demo/post/post-1",
        username: "demo",
        view_count: 0,
      },
      {
        avatar_url: "",
        created_at: "",
        crawled_at: "",
        display_name: "demo-2",
        language: "vi",
        like_count: 0,
        media: [],
        post_id: "post-2",
        ranking: { breakdown: {}, final_score: 1, mode: "weighted", sort_by: "views" },
        reply_count: 0,
        repost_count: 0,
        share_count: 0,
        source_url: "https://www.threads.com/@demo/post/post-2",
        text: "post 2",
        top_comments: [],
        url: "https://www.threads.com/@demo/post/post-2",
        username: "demo",
        view_count: 0,
      },
    ],
    request_meta: {
      created_at: "",
      date_range: { end_date: "", preset: "", start_date: "" },
      exclude_commerce_content: false,
      exclude_posts_with_links: false,
      exclude_usernames: [],
      global_excluded_keywords: [],
      include_usernames: [],
      languages: ["vi"],
      max_posts_per_topic: 3,
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
      min_text_length: 0,
      min_topic_match_score: 0,
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
      request_id: "previous",
      require_comments: false,
      require_metrics: false,
      require_repost_or_share: false,
      sort_by: "views",
      source: "threads",
      text_contains_all: [],
      text_contains_any: [],
      text_excludes_any: [],
      top_comments_per_post: 2,
      topic: {
        category: "test",
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
        topic_intent: "Resume Merge",
        topic_title: "Resume Merge",
      },
    },
    source: "threads",
    topic_id: "topic-resume-merge",
    topic_title: "Resume Merge",
  },
];

const current: TopicData[] = [
  {
    ...previous[0],
    crawled_at: "2026-06-26T00:10:00Z",
    crawl_audit: {
      completed_post_urls: ["https://www.threads.com/@demo/post/post-3"],
    },
    posts: [
      {
        avatar_url: "",
        created_at: "",
        crawled_at: "",
        display_name: "demo-3",
        language: "vi",
        like_count: 0,
        media: [],
        post_id: "post-3",
        ranking: { breakdown: {}, final_score: 1, mode: "weighted", sort_by: "views" },
        reply_count: 0,
        repost_count: 0,
        share_count: 0,
        source_url: "https://www.threads.com/@demo/post/post-3",
        text: "post 3",
        top_comments: [],
        url: "https://www.threads.com/@demo/post/post-3",
        username: "demo",
        view_count: 0,
      },
    ],
    request_meta: {
      ...previous[0].request_meta,
      max_posts_per_topic: 1,
      request_id: "resume",
      ui_state: {
        resume_baseline_posts: 2,
        resume_total_target_posts: 3,
      },
    },
  },
];

const merged = mergeTopicOutputs(previous, current);
const mergedTopic = merged[0];

if (!mergedTopic) {
  throw new Error("Expected merged topic output.");
}

if (mergedTopic.posts.length !== 3) {
  throw new Error(`Expected merged posts to keep 3 posts, got ${mergedTopic.posts.length}.`);
}

if (mergedTopic.request_meta.max_posts_per_topic !== 3) {
  throw new Error(
    `Expected merged max_posts_per_topic to stay at 3, got ${String(mergedTopic.request_meta.max_posts_per_topic)}.`,
  );
}

const completedUrls = Array.isArray(mergedTopic.crawl_audit?.completed_post_urls)
  ? mergedTopic.crawl_audit.completed_post_urls
  : [];

if (completedUrls.length !== 3) {
  throw new Error(`Expected merged completed_post_urls to be 3, got ${completedUrls.length}.`);
}

console.log("smoke:resume-output-merge ok");
