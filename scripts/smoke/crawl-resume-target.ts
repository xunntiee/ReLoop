import {
  applyOutputSummaryToProgress,
  buildResumeRequestFromOutput,
  hasReachedRunTarget,
  resolveRequestRuntimeOverrides,
  type CrawlRun,
} from "../../apps/server/src/modules/crawl/service";
import type { CrawlRequest } from "../../apps/server/src/modules/crawl/types";

const topic = {
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
  required_keywords_mode: "any" as const,
  search_queries: [],
  seed_post_urls: [],
  topic_intent: "viral",
  topic_title: "Viral feed",
  trend_search_urls: [],
};

const request: CrawlRequest = {
  created_at: "2026-06-25T00:00:00Z",
  filters: {
    date_range: {
      end_date: "2026-06-25",
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
    min_text_length: 0,
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
  notes: "smoke crawl resume target",
  request_id: "smoke-crawl-resume-target",
  runtime_overrides: {},
};

const run: CrawlRun = {
  configPath: "",
  id: "crawl-smoke",
  outputPath: "smoke.json",
  progress: {
    comment_completed: 25,
    comment_target: 25,
    committed_comments: 25,
    committed_posts: 5,
    pending_posts: 11,
    resume_ready: true,
    stage: "extracting_comments",
    summary_posts: 5,
    target_output_posts: 5,
    updated_at: "2026-06-25T00:00:00Z",
  },
  queuedAt: "2026-06-25T00:00:00Z",
  startedAt: "2026-06-25T00:00:00Z",
  status: "stopped_partial",
  topics: [topic.topic_title],
};

if (!hasReachedRunTarget(run.progress)) {
  throw new Error("Expected progress target to be treated as completed.");
}

applyOutputSummaryToProgress(run, request, {
  commentCount: 5,
  hasPosts: true,
  pendingResumeCount: 0,
  postCount: 1,
  previewPostCount: 0,
});

if (run.progress?.committed_posts !== 5 || run.progress?.summary_posts !== 5) {
  throw new Error(
    `Expected preserved post count to stay at 5, got ${String(run.progress?.committed_posts)} / ${String(run.progress?.summary_posts)}.`,
  );
}

if (
  run.progress?.committed_comments !== 25 ||
  run.progress?.comment_completed !== 25
) {
  throw new Error(
    `Expected preserved comment count to stay at 25, got ${String(run.progress?.committed_comments)} / ${String(run.progress?.comment_completed)}.`,
  );
}

if (run.progress?.pending_posts !== 0 || run.progress?.resume_ready !== false) {
  throw new Error(
    `Expected reached target to clear pending/resume flags, got pending=${String(run.progress?.pending_posts)} resume=${String(run.progress?.resume_ready)}.`,
  );
}

const checkpointRun: CrawlRun = {
  ...run,
  id: "crawl-smoke-checkpoint",
  progress: {
    ...run.progress!,
    committed_comments: 25,
    committed_posts: 5,
    pending_posts: 0,
    resume_ready: false,
    summary_posts: 5,
  },
};

applyOutputSummaryToProgress(checkpointRun, request, {
  commentCount: 0,
  hasPosts: false,
  pendingResumeCount: 19,
  postCount: 0,
  previewPostCount: 0,
});

if (
  checkpointRun.progress?.committed_posts !== 0 ||
  checkpointRun.progress?.summary_posts !== 0 ||
  checkpointRun.progress?.committed_comments !== 0
) {
  throw new Error(
    `Expected checkpoint-only output to reset committed counts to 0, got posts=${String(checkpointRun.progress?.committed_posts)} comments=${String(checkpointRun.progress?.committed_comments)}.`,
  );
}

if (
  checkpointRun.progress?.pending_posts !== 19 ||
  checkpointRun.progress?.resume_ready !== true
) {
  throw new Error(
    `Expected checkpoint-only output to keep resume path, got pending=${String(checkpointRun.progress?.pending_posts)} resume=${String(checkpointRun.progress?.resume_ready)}.`,
  );
}

const completedUrls = Array.from({ length: 5 }, (_, index) =>
  `https://www.threads.com/@demo/post/post-${index + 1}`,
);
const pendingUrls = Array.from({ length: 6 }, (_, index) =>
  `https://www.threads.com/@demo/post/pending-${index + 1}`,
);
const output = [
  {
    crawled_at: "2026-06-25T00:00:00Z",
    crawl_audit: {
      completed_post_urls: completedUrls,
      pending_post_urls: pendingUrls,
      resume_seed_urls: [...completedUrls, ...pendingUrls],
    },
    keywords: [],
    posts: completedUrls.map((url, index) => ({
      top_comments: Array.from({ length: 5 }, (_, commentIndex) => ({
        comment_id: `comment-${index + 1}-${commentIndex + 1}`,
      })),
      url,
    })),
    request_meta: {
      date_range: request.filters.date_range,
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
      min_text_length: 0,
      min_topic_match_score: 0,
      ranking_weights: request.filters.ranking_weights,
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
      topic,
    },
    source: "threads",
    topic_title: topic.topic_title,
  },
];

let blockedResume = false;
try {
  buildResumeRequestFromOutput(output, run);
} catch (error) {
  blockedResume = /(da du target|đã đủ target)/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

if (!blockedResume) {
  throw new Error(
    "Expected completed partial output to reject resume when target is already satisfied.",
  );
}

const runtimeOverrides = resolveRequestRuntimeOverrides(
  {
    includeHomeFeed: false,
    maxCandidateLinks: 4,
    maxCollectedPostsPerTopic: 4,
    maxSearchQueriesPerTopic: 0,
  },
  undefined,
);

if (
  runtimeOverrides.includeHomeFeed !== false ||
  runtimeOverrides.maxSearchQueriesPerTopic !== 0 ||
  runtimeOverrides.maxCandidateLinks !== 4 ||
  runtimeOverrides.maxCollectedPostsPerTopic !== 4
) {
  throw new Error(
    `Expected runtime overrides to be preserved for resume runs, got ${JSON.stringify(runtimeOverrides)}.`,
  );
}

console.log("smoke:crawl-resume-target ok");
